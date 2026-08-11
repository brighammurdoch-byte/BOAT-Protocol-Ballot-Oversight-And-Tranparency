//! Groth16 proof verification helpers for `cast_vote_zk`.
//!
//! - `dev_mode`: accepts the deterministic binder proof from `@boat/zk-circuits`
//!   (`BOAT_GROTH16_DEV_V0`). **Not secure** — for local/CI and tiny trials only.
//! - Production path (`dev_mode=false`): verifies with `groth16-solana` against
//!   the embedded ceremony VK in `verifying_key.rs`.

use anchor_lang::prelude::*;
use groth16_solana::groth16::Groth16Verifier;
use solana_sha256_hasher::hashv;

use crate::verifying_key::VERIFYING_KEY;

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
        for b in &self.outcome_index[..31] {
            require!(*b == 0, crate::ErrorCode::InvalidZkPublicInputs);
        }
        Ok(self.outcome_index[31])
    }

    pub fn as_array(&self) -> [[u8; 32]; PUBLIC_INPUT_COUNT] {
        [
            self.merkle_root,
            self.nullifier,
            self.outcome_index,
            self.election_id,
        ]
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

/// Verify proof bytes.
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

/// Production Groth16 verify via alt_bn128 syscalls (`groth16-solana`).
/// Proof layout (256 bytes): proof_a[64] || proof_b[128] || proof_c[64]
/// as expected by `Groth16Verifier` (snarkjs proofs must be packed client-side).
fn verify_groth16_production(proof: &[u8], inputs: &ZkPublicInputs) -> Result<()> {
    let proof_a: [u8; 64] = proof[0..64]
        .try_into()
        .map_err(|_| error!(crate::ErrorCode::InvalidZkProof))?;
    let proof_b: [u8; 128] = proof[64..192]
        .try_into()
        .map_err(|_| error!(crate::ErrorCode::InvalidZkProof))?;
    let proof_c: [u8; 64] = proof[192..256]
        .try_into()
        .map_err(|_| error!(crate::ErrorCode::InvalidZkProof))?;

    let public_inputs = inputs.as_array();
    let mut verifier = Groth16Verifier::<PUBLIC_INPUT_COUNT>::new(
        &proof_a,
        &proof_b,
        &proof_c,
        &public_inputs,
        &VERIFYING_KEY,
    )
    .map_err(|_| error!(crate::ErrorCode::InvalidZkProof))?;

    verifier
        .verify()
        .map_err(|_| error!(crate::ErrorCode::InvalidZkProof))?;
    Ok(())
}

/// Encode election pubkey into the same 32-byte id used by the TS helper.
pub fn election_id_from_pubkey(key: &Pubkey) -> [u8; 32] {
    let mut out = key.to_bytes();
    out[0] &= 0x1f;
    out
}
