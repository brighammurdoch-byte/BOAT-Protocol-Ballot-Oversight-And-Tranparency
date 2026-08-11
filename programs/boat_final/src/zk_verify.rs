//! Groth16 proof verification helpers for `cast_vote_zk`.
//!
//! - `dev_mode`: accepts the deterministic binder proof from `@boat/zk-circuits`
//!   (`BOAT_GROTH16_DEV_V0`). **Not secure** — for local/CI and tiny trials only.
//! - Production path: verify with `groth16-solana` once a ceremony VK is embedded
//!   (see `verify_groth16_production` stub).

use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

pub const GROTH16_PROOF_LEN: usize = 256;
pub const PUBLIC_INPUT_COUNT: usize = 4;
pub const DEV_PROOF_DOMAIN: &[u8] = b"BOAT_GROTH16_DEV_V0";

#[derive(Clone, Debug)]
pub struct ZkPublicInputs {
    pub merkle_root: [u8; 32],
    pub nullifier: [u8; 32],
    pub outcome_index: [u8; 32],
    pub election_id: [u8; 32],
}

impl ZkPublicInputs {
    pub fn from_slices(inputs: &[[u8; 32]]) -> Result<Self> {
        require!(
            inputs.len() == PUBLIC_INPUT_COUNT,
            crate::ErrorCode::InvalidZkPublicInputs
        );
        Ok(Self {
            merkle_root: inputs[0],
            nullifier: inputs[1],
            outcome_index: inputs[2],
            election_id: inputs[3],
        })
    }

    pub fn outcome_index_u8(&self) -> Result<u8> {
        // Big-endian field: only last byte may be non-zero for v0 indices.
        for b in &self.outcome_index[..31] {
            require!(*b == 0, crate::ErrorCode::InvalidZkPublicInputs);
        }
        Ok(self.outcome_index[31])
    }
}

pub fn compute_dev_binder(inputs: &ZkPublicInputs) -> [u8; 32] {
    let h = hashv(&[
        DEV_PROOF_DOMAIN,
        &inputs.merkle_root,
        &inputs.nullifier,
        &inputs.outcome_index,
        &inputs.election_id,
    ]);
    h.to_bytes()
}

/// Verify proof bytes. When `dev_mode`, checks binder layout (`proof[0]==1`).
/// When not `dev_mode`, attempts production Groth16 verify (currently rejects
/// until a VK is configured — forces explicit ceremony before campus use).
pub fn verify_proof(proof: &[u8], inputs: &ZkPublicInputs, dev_mode: bool) -> Result<()> {
    require!(
        proof.len() == GROTH16_PROOF_LEN,
        crate::ErrorCode::InvalidZkProof
    );

    if dev_mode {
        require!(proof[0] == 0x01, crate::ErrorCode::InvalidZkProof);
        let binder = compute_dev_binder(inputs);
        require!(proof[1..33] == binder, crate::ErrorCode::InvalidZkProof);
        return Ok(());
    }

    verify_groth16_production(proof, inputs)
}

/// Production hook: integrate `groth16-solana` + embedded verifying key here.
/// Until a ceremony VK is shipped, this returns `ZkVerifierNotConfigured`.
fn verify_groth16_production(_proof: &[u8], _inputs: &ZkPublicInputs) -> Result<()> {
    // Intentionally hard-fail: do not silently accept proofs without a VK.
    // When ready:
    //   use groth16_solana::groth16::Groth16Verifier;
    //   let mut verifier = Groth16Verifier::new(&_proof[..], &public, &VK)?;
    //   verifier.verify()?;
    err!(crate::ErrorCode::ZkVerifierNotConfigured)
}

/// Encode election pubkey into the same 32-byte id used by the TS helper.
pub fn election_id_from_pubkey(key: &Pubkey) -> [u8; 32] {
    let mut out = key.to_bytes();
    out[0] &= 0x1f;
    out
}
