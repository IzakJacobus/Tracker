//! Certificate pinning for the Stint Server's self-made certificate authority.
//!
//! During pairing we learn the server's CA certificate and pin the SHA-256 of its
//! public key (SPKI). Afterwards every HTTPS connection must present a leaf
//! certificate signed by exactly that CA. Host names are not checked: the server's
//! IP address can change with DHCP, and trust comes from the pinned private CA,
//! not from a public name.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::client::WebPkiServerVerifier;
use rustls::crypto::{ring, CryptoProvider};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{CertificateError, DigitallySignedStruct, Error, RootCertStore, SignatureScheme};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};

pub fn provider() -> Arc<CryptoProvider> {
    Arc::new(ring::default_provider())
}

/// base64url(SHA-256(SubjectPublicKeyInfo)) — the same value the server advertises.
pub fn spki_fingerprint(der: &[u8]) -> Result<String, String> {
    let (_, cert) = x509_parser::parse_x509_certificate(der).map_err(|e| format!("bad certificate: {e}"))?;
    let digest = Sha256::digest(cert.tbs_certificate.subject_pki.raw);
    Ok(URL_SAFE_NO_PAD.encode(digest))
}

/// Accepts only chains that end in the pinned CA; ignores host-name mismatches.
#[derive(Debug)]
pub struct PinnedVerifier {
    inner: Arc<WebPkiServerVerifier>,
    provider: Arc<CryptoProvider>,
}

impl PinnedVerifier {
    pub fn new(ca_der: &[u8]) -> Result<Self, String> {
        let mut roots = RootCertStore::empty();
        roots
            .add(CertificateDer::from(ca_der.to_vec()))
            .map_err(|e| format!("invalid CA certificate: {e}"))?;
        let provider = provider();
        let inner = WebPkiServerVerifier::builder_with_provider(Arc::new(roots), provider.clone())
            .build()
            .map_err(|e| format!("verifier: {e}"))?;
        Ok(Self { inner, provider })
    }
}

fn is_name_error(e: &Error) -> bool {
    matches!(
        e,
        Error::InvalidCertificate(CertificateError::NotValidForName)
            | Error::InvalidCertificate(CertificateError::NotValidForNameContext { .. })
    )
}

impl ServerCertVerifier for PinnedVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, Error> {
        match self.inner.verify_server_cert(end_entity, intermediates, server_name, ocsp, now) {
            Ok(v) => Ok(v),
            Err(e) if is_name_error(&e) => Ok(ServerCertVerified::assertion()),
            Err(e) => Err(e),
        }
    }

    fn verify_tls12_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn verify_tls13_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider.signature_verification_algorithms.supported_schemes()
    }
}

/// Used only while pairing: records the presented chain so we can check it against
/// the expected fingerprint before trusting it. Signatures are still verified.
#[derive(Debug, Default)]
pub struct CapturingVerifier {
    pub chain: Mutex<Vec<Vec<u8>>>,
}

impl ServerCertVerifier for CapturingVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, Error> {
        let mut chain = vec![end_entity.to_vec()];
        chain.extend(intermediates.iter().map(|c| c.to_vec()));
        *self.chain.lock().unwrap() = chain;
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &provider().signature_verification_algorithms)
    }

    fn verify_tls13_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &provider().signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        provider().signature_verification_algorithms.supported_schemes()
    }
}

pub fn client_config(verifier: Arc<dyn ServerCertVerifier>) -> Result<rustls::ClientConfig, String> {
    Ok(rustls::ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth())
}

/// After a capturing handshake: is `chain` a leaf signed by a CA whose fingerprint
/// matches `accept`? Returns the CA certificate (DER) and its full fingerprint.
pub fn check_chain(chain: &[Vec<u8>], accept: impl Fn(&str) -> bool) -> Result<(Vec<u8>, String), String> {
    let leaf = chain.first().ok_or("the server sent no certificate")?;
    for ca in chain.iter().skip(1).rev() {
        let fp = spki_fingerprint(ca)?;
        if !accept(&fp) {
            continue;
        }
        let v = PinnedVerifier::new(ca)?;
        let inters: Vec<CertificateDer> = chain.iter().skip(1).map(|c| CertificateDer::from(c.clone())).collect();
        let name = ServerName::try_from("stint.local").map_err(|e| e.to_string())?;
        v.verify_server_cert(&CertificateDer::from(leaf.clone()), &inters, &name, &[], UnixTime::now())
            .map_err(|e| format!("the server's certificate doesn't match its authority: {e}"))?;
        return Ok((ca.clone(), fp));
    }
    Err("This isn't the Stint Server you expected (its security fingerprint doesn't match).".into())
}
