use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, MintTo},
};

declare_id!("5ZvG5oXKD6YKgWkAKWQMjdAb3vXEWzRNNGk3uRSt63gP");

/// Registration: only authority can call `register_voter`.
pub const REGISTRATION_AUTHORITY_ONLY: u8 = 0;
/// Self-serve registration before voting starts; weight = `default_voter_weight`.
pub const REGISTRATION_OPEN: u8 = 1;
/// Self-serve if Merkle proof verifies against `merkle_root`.
pub const REGISTRATION_MERKLE: u8 = 2;

#[program]
pub mod boat_final {
    use super::*;

    pub fn initialize_election(
        ctx: Context<InitializeElection>,
        title: String,
        start_time: i64,
        end_time: i64,
    ) -> Result<()> {
        let election = &mut ctx.accounts.election;
        election.authority = ctx.accounts.authority.key();
        election.title = title;
        election.start_time = start_time;
        election.end_time = end_time;
        election.sbt_mint = ctx.accounts.sbt_mint.key();
        election.bump = ctx.bumps.election;
        election.total_weight = 0;
        election.denom_factor = 1;
        election.registered_voter_count = 0;
        election.outcome_count = 0;

        let config = &mut ctx.accounts.election_config;
        config.election = election.key();
        config.default_voter_weight = 1;
        config.quorum_percentage = 33;
        config.max_free_vote_changes = 2;
        config.price_per_vote_change = 0;
        config.allow_delegation = true;
        config.allow_token_voting = false;
        config.token_mint = None;
        config.min_token_balance = 0;
        config.registration_mode = REGISTRATION_AUTHORITY_ONLY;
        config.merkle_root = [0u8; 32];
        config.registration_end_ts = 0;
        config.max_registered_voters = 0;
        config.registration_fee_lamports = 0;

        msg!("Election Initialized: {}", election.title);
        Ok(())
    }

    pub fn set_election_config(
        ctx: Context<SetElectionConfig>,
        default_voter_weight: u64,
        quorum_percentage: u8,
        max_free_vote_changes: u8,
        price_per_vote_change: u64,
        allow_delegation: bool,
    ) -> Result<()> {
        require!(
            quorum_percentage > 0 && quorum_percentage <= 100,
            ErrorCode::InvalidQuorumPercentage
        );

        let config = &mut ctx.accounts.election_config;
        config.default_voter_weight = default_voter_weight;
        config.quorum_percentage = quorum_percentage;
        config.max_free_vote_changes = max_free_vote_changes;
        config.price_per_vote_change = price_per_vote_change;
        config.allow_delegation = allow_delegation;

        msg!("Election config updated");
        Ok(())
    }

    /// Update self-registration policy (authority only, before voting starts).
    pub fn set_registration_policy(
        ctx: Context<SetRegistrationPolicy>,
        registration_mode: u8,
        merkle_root: [u8; 32],
        registration_end_ts: i64,
        max_registered_voters: u32,
        registration_fee_lamports: u64,
    ) -> Result<()> {
        require!(
            registration_mode <= REGISTRATION_MERKLE,
            ErrorCode::InvalidRegistrationMode
        );
        if registration_mode == REGISTRATION_MERKLE {
            require!(merkle_root != [0u8; 32], ErrorCode::InvalidMerkleRoot);
        }

        let clock = Clock::get()?;
        let election = &ctx.accounts.election;
        require!(
            clock.unix_timestamp < election.start_time,
            ErrorCode::ElectionAlreadyStarted
        );

        let config = &mut ctx.accounts.election_config;
        config.registration_mode = registration_mode;
        config.merkle_root = merkle_root;
        config.registration_end_ts = registration_end_ts;
        config.max_registered_voters = max_registered_voters;
        config.registration_fee_lamports = registration_fee_lamports;

        msg!("Registration policy updated mode={}", registration_mode);
        Ok(())
    }

    pub fn enable_token_voting(
        ctx: Context<EnableTokenVoting>,
        min_token_balance: u64,
    ) -> Result<()> {
        let config = &mut ctx.accounts.election_config;
        config.allow_token_voting = true;
        config.token_mint = Some(ctx.accounts.token_mint.key());
        config.min_token_balance = min_token_balance;

        msg!(
            "Token-based voting enabled for mint: {}",
            ctx.accounts.token_mint.key()
        );
        Ok(())
    }

    /// Authority-sponsored voter registration (any registration mode).
    pub fn register_voter(ctx: Context<RegisterVoter>, weight: u64) -> Result<()> {
        let config = &ctx.accounts.election_config;
        let weight = if weight == 0 {
            config.default_voter_weight
        } else {
            weight
        };

        let election = &mut ctx.accounts.election;
        require_registration_cap(election, config)?;

        let voter_registry = &mut ctx.accounts.voter_registry;
        voter_registry.election = ctx.accounts.election.key();
        voter_registry.voter = ctx.accounts.voter.key();
        voter_registry.weight = weight;
        voter_registry.is_whitelisted = true;
        voter_registry.has_voted = false;
        voter_registry.current_vote = None;
        voter_registry.vote_changes_used = 0;
        voter_registry.delegated_to = None;
        voter_registry.bump = ctx.bumps.voter_registry;

        election.total_weight = election.total_weight.saturating_add(weight);
        election.registered_voter_count = election
            .registered_voter_count
            .checked_add(1)
            .ok_or(ErrorCode::MaxVotersReached)?;

        token_interface::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.sbt_mint.to_account_info(),
                    to: ctx.accounts.voter_token_account.to_account_info(),
                    authority: election.to_account_info(),
                },
                &[&[
                    b"election".as_ref(),
                    election.authority.as_ref(),
                    election.title.as_bytes(),
                    &[election.bump],
                ]],
            ),
            weight,
        )?;

        msg!(
            "Voter {} registered with weight: {}",
            ctx.accounts.voter.key(),
            weight
        );
        Ok(())
    }

    /// Admin-sponsored registration (voter signs; authority pays rent/fees).
    pub fn register_voter_sponsored(
        ctx: Context<RegisterVoterSponsored>,
        merkle_proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        let config = &ctx.accounts.election_config;
        require!(
            config.registration_mode == REGISTRATION_OPEN
                || config.registration_mode == REGISTRATION_MERKLE,
            ErrorCode::SelfRegistrationNotAllowed
        );

        let clock = Clock::get()?;
        let election = &mut ctx.accounts.election;
        require!(
            clock.unix_timestamp < election.start_time,
            ErrorCode::RegistrationClosed
        );
        if config.registration_end_ts > 0 {
            require!(
                clock.unix_timestamp <= config.registration_end_ts,
                ErrorCode::RegistrationClosed
            );
        }

        require_registration_cap(election, config)?;

        let voter_key = ctx.accounts.voter.key();
        if config.registration_mode == REGISTRATION_MERKLE {
            let leaf = leaf_hash(&election.key(), &voter_key);
            require!(
                verify_merkle_proof(&config.merkle_root, &leaf, &merkle_proof),
                ErrorCode::MerkleProofInvalid
            );
        }

        let weight = config.default_voter_weight;

        let voter_registry = &mut ctx.accounts.voter_registry;
        voter_registry.election = election.key();
        voter_registry.voter = voter_key;
        voter_registry.weight = weight;
        voter_registry.is_whitelisted = true;
        voter_registry.has_voted = false;
        voter_registry.current_vote = None;
        voter_registry.vote_changes_used = 0;
        voter_registry.delegated_to = None;
        voter_registry.bump = ctx.bumps.voter_registry;

        election.total_weight = election.total_weight.saturating_add(weight);
        election.registered_voter_count = election
            .registered_voter_count
            .checked_add(1)
            .ok_or(ErrorCode::MaxVotersReached)?;

        token_interface::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.sbt_mint.to_account_info(),
                    to: ctx.accounts.voter_token_account.to_account_info(),
                    authority: election.to_account_info(),
                },
                &[&[
                    b"election".as_ref(),
                    election.authority.as_ref(),
                    election.title.as_bytes(),
                    &[election.bump],
                ]],
            ),
            weight,
        )?;

        msg!(
            "Voter {} sponsored-registered with weight: {}",
            voter_key,
            weight
        );
        Ok(())
    }

    /// Add a voting outcome (candidate). `outcome_index` must equal `election.outcome_count`.
    pub fn add_outcome(
        ctx: Context<AddOutcome>,
        label: String,
        outcome_index: u8,
    ) -> Result<()> {
        require!(label.len() <= 64, ErrorCode::LabelTooLong);
        let clock = Clock::get()?;
        let election = &mut ctx.accounts.election;
        require!(
            clock.unix_timestamp < election.start_time,
            ErrorCode::ElectionAlreadyStarted
        );

        let outcome = &mut ctx.accounts.outcome;
        let election_key = election.key();
        outcome.election = election_key;
        outcome.index = outcome_index;
        outcome.label = label.clone();
        outcome.bump = ctx.bumps.outcome;

        emit!(OutcomeAdded {
            election: election_key,
            index: outcome_index,
            label: label.clone(),
        });

        election.outcome_count = election
            .outcome_count
            .checked_add(1)
            .ok_or(ErrorCode::TooManyOutcomes)?;

        msg!("Outcome {} added: {}", outcome_index, label);
        Ok(())
    }

    pub fn delegate_vote(ctx: Context<DelegateVote>) -> Result<()> {
        let config = &ctx.accounts.election_config;
        require!(config.allow_delegation, ErrorCode::DelegationNotAllowed);

        let voter_registry = &mut ctx.accounts.voter_registry;
        require!(voter_registry.is_whitelisted, ErrorCode::NotWhitelisted);
        require!(!voter_registry.has_voted, ErrorCode::AlreadyVoted);

        let delegate_registry = &ctx.accounts.delegate_registry;
        require!(delegate_registry.is_whitelisted, ErrorCode::DelegateNotWhitelisted);

        voter_registry.delegated_to = Some(delegate_registry.voter);

        msg!(
            "Vote delegated from {} to {}",
            voter_registry.voter,
            delegate_registry.voter
        );
        Ok(())
    }

    pub fn cast_vote(ctx: Context<CastVote>, outcome_index: u8) -> Result<()> {
        let election = &ctx.accounts.election;
        let clock = Clock::get()?;

        require!(election.outcome_count > 0, ErrorCode::NoOutcomesDefined);
        require!(
            clock.unix_timestamp >= election.start_time,
            ErrorCode::ElectionNotStarted
        );
        require!(
            clock.unix_timestamp <= election.end_time,
            ErrorCode::ElectionEnded
        );

        let outcome = &ctx.accounts.outcome;
        require!(outcome.index == outcome_index, ErrorCode::InvalidOutcome);
        let candidate_label = outcome.label.clone();

        let voter_registry = &mut ctx.accounts.voter_registry;
        require!(voter_registry.is_whitelisted, ErrorCode::NotWhitelisted);
        require!(
            voter_registry.delegated_to.is_none(),
            ErrorCode::CannotVoteIfDelegated
        );

        let user_weight = ctx.accounts.voter_token_account.amount;
        require!(user_weight > 0, ErrorCode::NoVotingPower);
        require!(user_weight == voter_registry.weight, ErrorCode::WeightMismatch);

        if voter_registry.has_voted {
            let config = &ctx.accounts.election_config;
            if voter_registry.vote_changes_used >= config.max_free_vote_changes {
                if config.price_per_vote_change > 0 {
                    let cpi_context = CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        anchor_lang::system_program::Transfer {
                            from: ctx.accounts.voter.to_account_info(),
                            to: ctx.accounts.fee_receiver.to_account_info(),
                        },
                    );
                    anchor_lang::system_program::transfer(
                        cpi_context,
                        config.price_per_vote_change,
                    )?;
                }
            }
            voter_registry.vote_changes_used = voter_registry.vote_changes_used.saturating_add(1);
        }

        voter_registry.current_vote = Some(candidate_label.clone());
        voter_registry.has_voted = true;

        msg!(
            "Vote recorded for: {} from voter: {} with weight: {}",
            candidate_label,
            voter_registry.voter,
            user_weight
        );

        emit!(VoteCast {
            election: election.key(),
            voter: voter_registry.voter,
            candidate: candidate_label,
            weight: user_weight,
            timestamp: clock.unix_timestamp,
            vote_change_number: voter_registry.vote_changes_used,
        });

        Ok(())
    }

    pub fn cast_vote_with_token(
        ctx: Context<CastVoteWithToken>,
        outcome_index: u8,
    ) -> Result<()> {
        let election = &ctx.accounts.election;
        let config = &ctx.accounts.election_config;
        let clock = Clock::get()?;

        require!(election.outcome_count > 0, ErrorCode::NoOutcomesDefined);
        require!(
            clock.unix_timestamp >= election.start_time,
            ErrorCode::ElectionNotStarted
        );
        require!(
            clock.unix_timestamp <= election.end_time,
            ErrorCode::ElectionEnded
        );
        require!(config.allow_token_voting, ErrorCode::TokenVotingNotEnabled);

        let outcome = &ctx.accounts.outcome;
        require!(outcome.index == outcome_index, ErrorCode::InvalidOutcome);
        let candidate_label = outcome.label.clone();

        let voter_token_balance = ctx.accounts.voter_token_account.amount;
        require!(
            voter_token_balance >= config.min_token_balance,
            ErrorCode::InsufficientTokenBalance
        );

        let voting_weight = voter_token_balance;

        msg!(
            "Vote recorded for: {} from token holder with weight: {}",
            candidate_label,
            voting_weight
        );

        emit!(VoteCast {
            election: election.key(),
            voter: ctx.accounts.voter.key(),
            candidate: candidate_label,
            weight: voting_weight,
            timestamp: clock.unix_timestamp,
            vote_change_number: 0,
        });

        Ok(())
    }
}

fn require_registration_cap(election: &Election, config: &ElectionConfig) -> Result<()> {
    if config.max_registered_voters > 0 {
        require!(
            election.registered_voter_count < config.max_registered_voters,
            ErrorCode::MaxVotersReached
        );
    }
    Ok(())
}

pub fn leaf_hash(election: &Pubkey, voter: &Pubkey) -> [u8; 32] {
    hashv(&[b"BOAT_V1", election.as_ref(), voter.as_ref()]).to_bytes()
}

fn verify_merkle_proof(root: &[u8; 32], leaf: &[u8; 32], proof: &[[u8; 32]]) -> bool {
    let mut acc = *leaf;
    for p in proof {
        let (l, r) = if acc <= *p {
            (&acc, p)
        } else {
            (p, &acc)
        };
        acc = hashv(&[l.as_ref(), r.as_ref()]).to_bytes();
    }
    acc == *root
}

#[account]
pub struct Election {
    pub authority: Pubkey,
    pub title: String,
    pub start_time: i64,
    pub end_time: i64,
    pub sbt_mint: Pubkey,
    pub bump: u8,
    pub total_weight: u64,
    pub denom_factor: u64,
    pub registered_voter_count: u32,
    pub outcome_count: u8,
}

#[account]
pub struct ElectionConfig {
    pub election: Pubkey,
    pub default_voter_weight: u64,
    pub quorum_percentage: u8,
    pub max_free_vote_changes: u8,
    pub price_per_vote_change: u64,
    pub allow_delegation: bool,
    pub allow_token_voting: bool,
    pub token_mint: Option<Pubkey>,
    pub min_token_balance: u64,
    pub registration_mode: u8,
    pub merkle_root: [u8; 32],
    pub registration_end_ts: i64,
    pub max_registered_voters: u32,
    pub registration_fee_lamports: u64,
}

#[account]
#[derive(Default)]
pub struct ElectionOutcome {
    pub election: Pubkey,
    pub index: u8,
    pub label: String,
    pub bump: u8,
}

#[account]
#[derive(Default)]
pub struct VoterRegistry {
    pub election: Pubkey,
    pub voter: Pubkey,
    pub weight: u64,
    pub is_whitelisted: bool,
    pub has_voted: bool,
    pub current_vote: Option<String>,
    pub vote_changes_used: u8,
    pub delegated_to: Option<Pubkey>,
    pub bump: u8,
}

#[event]
pub struct VoteCast {
    pub election: Pubkey,
    pub voter: Pubkey,
    pub candidate: String,
    pub weight: u64,
    pub timestamp: i64,
    pub vote_change_number: u8,
}

#[event]
pub struct OutcomeAdded {
    pub election: Pubkey,
    pub index: u8,
    pub label: String,
}

#[derive(Accounts)]
#[instruction(title: String)]
pub struct InitializeElection<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + (4 + title.len()) + 8 + 8 + 32 + 1 + 8 + 8 + 4 + 1,
        seeds = [b"election", authority.key().as_ref(), title.as_bytes()],
        bump
    )]
    pub election: Account<'info, Election>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 8 + 1 + 1 + 8 + 1 + 1 + (1 + 32) + 8 + 1 + 32 + 8 + 4 + 8,
        seeds = [b"config", election.key().as_ref()],
        bump
    )]
    pub election_config: Account<'info, ElectionConfig>,

    #[account(
        init,
        payer = authority,
        seeds = [b"mint", election.key().as_ref()],
        bump,
        mint::decimals = 0,
        mint::authority = election,
        mint::freeze_authority = election,
        mint::token_program = token_program
    )]
    pub sbt_mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct SetElectionConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(has_one = authority)]
    pub election: Account<'info, Election>,

    #[account(mut, has_one = election)]
    pub election_config: Account<'info, ElectionConfig>,
}

#[derive(Accounts)]
pub struct SetRegistrationPolicy<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, has_one = authority)]
    pub election: Account<'info, Election>,

    #[account(mut, has_one = election)]
    pub election_config: Account<'info, ElectionConfig>,
}

#[derive(Accounts)]
pub struct EnableTokenVoting<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(has_one = authority)]
    pub election: Account<'info, Election>,

    #[account(mut, has_one = election)]
    pub election_config: Account<'info, ElectionConfig>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterVoter<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, has_one = authority, has_one = sbt_mint)]
    pub election: Account<'info, Election>,

    #[account(has_one = election)]
    pub election_config: Account<'info, ElectionConfig>,

    #[account(mut)]
    pub sbt_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: voter pubkey for PDA seeds
    #[account(mut)]
    pub voter: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 8 + 1 + 1 + (1 + 4 + 100) + 1 + (1 + 32) + 1,
        seeds = [b"voter_registry", election.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub voter_registry: Account<'info, VoterRegistry>,

    #[account(
        init,
        payer = authority,
        associated_token::mint = sbt_mint,
        associated_token::authority = voter,
        associated_token::token_program = token_program
    )]
    pub voter_token_account: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct RegisterVoterSponsored<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub voter: Signer<'info>,

    #[account(mut, has_one = authority, has_one = sbt_mint)]
    pub election: Account<'info, Election>,

    #[account(has_one = election)]
    pub election_config: Account<'info, ElectionConfig>,

    #[account(mut)]
    pub sbt_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 8 + 1 + 1 + (1 + 4 + 100) + 1 + (1 + 32) + 1,
        seeds = [b"voter_registry", election.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub voter_registry: Account<'info, VoterRegistry>,

    #[account(
        init,
        payer = authority,
        associated_token::mint = sbt_mint,
        associated_token::authority = voter,
        associated_token::token_program = token_program
    )]
    pub voter_token_account: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(label: String, outcome_index: u8)]
pub struct AddOutcome<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority,
        constraint = election.outcome_count == outcome_index @ ErrorCode::InvalidOutcomeIndex
    )]
    pub election: Account<'info, Election>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 1 + (4 + 64) + 1,
        seeds = [b"outcome", election.key().as_ref(), &[outcome_index]],
        bump
    )]
    pub outcome: Account<'info, ElectionOutcome>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DelegateVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,

    pub election: Account<'info, Election>,
    pub election_config: Account<'info, ElectionConfig>,

    #[account(mut, has_one = election, has_one = voter)]
    pub voter_registry: Account<'info, VoterRegistry>,

    #[account(has_one = election)]
    pub delegate_registry: Account<'info, VoterRegistry>,
}

#[derive(Accounts)]
#[instruction(outcome_index: u8)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,

    #[account(mut)]
    pub fee_receiver: UncheckedAccount<'info>,

    #[account(mut)]
    pub election: Account<'info, Election>,

    pub election_config: Account<'info, ElectionConfig>,

    #[account(mut)]
    pub sbt_mint: InterfaceAccount<'info, Mint>,

    #[account(mut, has_one = election, has_one = voter)]
    pub voter_registry: Account<'info, VoterRegistry>,

    #[account(
        mut,
        associated_token::mint = sbt_mint,
        associated_token::authority = voter,
        associated_token::token_program = token_program
    )]
    pub voter_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        seeds = [b"outcome", election.key().as_ref(), &[outcome_index]],
        bump = outcome.bump,
        constraint = outcome.election == election.key() @ ErrorCode::InvalidOutcome,
        constraint = outcome.index == outcome_index @ ErrorCode::InvalidOutcome
    )]
    pub outcome: Account<'info, ElectionOutcome>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(outcome_index: u8)]
pub struct CastVoteWithToken<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,

    pub election: Account<'info, Election>,
    pub election_config: Account<'info, ElectionConfig>,

    #[account(
        associated_token::mint = token_mint,
        associated_token::authority = voter,
        associated_token::token_program = token_program
    )]
    pub voter_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,

    #[account(
        seeds = [b"outcome", election.key().as_ref(), &[outcome_index]],
        bump = outcome.bump,
        constraint = outcome.election == election.key() @ ErrorCode::InvalidOutcome,
        constraint = outcome.index == outcome_index @ ErrorCode::InvalidOutcome
    )]
    pub outcome: Account<'info, ElectionOutcome>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Election has not started yet.")]
    ElectionNotStarted,
    #[msg("Election is already over.")]
    ElectionEnded,
    #[msg("You have no voting tokens remaining.")]
    NoVotingPower,
    #[msg("Invalid quorum percentage (must be 1-100).")]
    InvalidQuorumPercentage,
    #[msg("Voter is not whitelisted.")]
    NotWhitelisted,
    #[msg("Voter has already cast a vote.")]
    AlreadyVoted,
    #[msg("Voter has delegated their vote and cannot vote directly.")]
    CannotVoteIfDelegated,
    #[msg("Delegation is not allowed for this election.")]
    DelegationNotAllowed,
    #[msg("Delegate is not whitelisted.")]
    DelegateNotWhitelisted,
    #[msg("Voting weight does not match registry.")]
    WeightMismatch,
    #[msg("Token-based voting is not enabled for this election.")]
    TokenVotingNotEnabled,
    #[msg("Voter does not have sufficient token balance.")]
    InsufficientTokenBalance,
    #[msg("Self-registration is not enabled for this election.")]
    SelfRegistrationNotAllowed,
    #[msg("Registration is closed.")]
    RegistrationClosed,
    #[msg("Merkle proof invalid.")]
    MerkleProofInvalid,
    #[msg("Max registered voters reached.")]
    MaxVotersReached,
    #[msg("Invalid outcome.")]
    InvalidOutcome,
    #[msg("No outcomes defined for this election.")]
    NoOutcomesDefined,
    #[msg("Voting has already started.")]
    ElectionAlreadyStarted,
    #[msg("Outcome label too long.")]
    LabelTooLong,
    #[msg("Invalid outcome index.")]
    InvalidOutcomeIndex,
    #[msg("Too many outcomes.")]
    TooManyOutcomes,
    #[msg("Invalid registration mode.")]
    InvalidRegistrationMode,
    #[msg("Invalid merkle root.")]
    InvalidMerkleRoot,
}
