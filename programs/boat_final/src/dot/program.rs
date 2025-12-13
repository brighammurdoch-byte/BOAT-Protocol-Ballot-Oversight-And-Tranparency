#![allow(unused_imports)]
#![allow(unused_variables)]
#![allow(unused_mut)]
use crate::{id, seahorse_util::*};
use anchor_lang::{prelude::*, solana_program};
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use std::{cell::RefCell, rc::Rc};

#[account]
#[derive(Debug)]
pub struct Election {
    pub authority: Pubkey,
    pub title: String,
    pub is_active: bool,
}

impl<'info, 'entrypoint> Election {
    pub fn load(
        account: &'entrypoint mut Box<Account<'info, Self>>,
        programs_map: &'entrypoint ProgramsMap<'info>,
    ) -> Mutable<LoadedElection<'info, 'entrypoint>> {
        let authority = account.authority.clone();
        let title = account.title.clone();
        let is_active = account.is_active.clone();

        Mutable::new(LoadedElection {
            __account__: account,
            __programs__: programs_map,
            authority,
            title,
            is_active,
        })
    }

    pub fn store(loaded: Mutable<LoadedElection>) {
        let mut loaded = loaded.borrow_mut();
        let authority = loaded.authority.clone();

        loaded.__account__.authority = authority;

        let title = loaded.title.clone();

        loaded.__account__.title = title;

        let is_active = loaded.is_active.clone();

        loaded.__account__.is_active = is_active;
    }
}

#[derive(Debug)]
pub struct LoadedElection<'info, 'entrypoint> {
    pub __account__: &'entrypoint mut Box<Account<'info, Election>>,
    pub __programs__: &'entrypoint ProgramsMap<'info>,
    pub authority: Pubkey,
    pub title: String,
    pub is_active: bool,
}

#[account]
#[derive(Debug)]
pub struct Voter {
    pub authority: Pubkey,
    pub election: Pubkey,
    pub has_voted: bool,
}

impl<'info, 'entrypoint> Voter {
    pub fn load(
        account: &'entrypoint mut Box<Account<'info, Self>>,
        programs_map: &'entrypoint ProgramsMap<'info>,
    ) -> Mutable<LoadedVoter<'info, 'entrypoint>> {
        let authority = account.authority.clone();
        let election = account.election.clone();
        let has_voted = account.has_voted.clone();

        Mutable::new(LoadedVoter {
            __account__: account,
            __programs__: programs_map,
            authority,
            election,
            has_voted,
        })
    }

    pub fn store(loaded: Mutable<LoadedVoter>) {
        let mut loaded = loaded.borrow_mut();
        let authority = loaded.authority.clone();

        loaded.__account__.authority = authority;

        let election = loaded.election.clone();

        loaded.__account__.election = election;

        let has_voted = loaded.has_voted.clone();

        loaded.__account__.has_voted = has_voted;
    }
}

#[derive(Debug)]
pub struct LoadedVoter<'info, 'entrypoint> {
    pub __account__: &'entrypoint mut Box<Account<'info, Voter>>,
    pub __programs__: &'entrypoint ProgramsMap<'info>,
    pub authority: Pubkey,
    pub election: Pubkey,
    pub has_voted: bool,
}

pub fn cast_vote_handler<'info>(
    mut voter: Mutable<LoadedVoter<'info, '_>>,
    mut signer: SeahorseSigner<'info, '_>,
    mut election: Mutable<LoadedElection<'info, '_>>,
    mut candidate: Pubkey,
) -> () {
    if !(voter.borrow().authority == signer.key()) {
        panic!("Not owner");
    }

    if !(!voter.borrow().has_voted) {
        panic!("Already voted");
    }

    if !(voter.borrow().election == election.borrow().__account__.key()) {
        panic!("Wrong election");
    }

    assign!(voter.borrow_mut().has_voted, true);

    solana_program::msg!("{}", format!("Vote cast for {:?}", candidate));
}

pub fn create_election_handler<'info>(
    mut owner: SeahorseSigner<'info, '_>,
    mut election: Empty<Mutable<LoadedElection<'info, '_>>>,
    mut title: String,
) -> () {
    let mut election = election.account.clone();

    assign!(election.borrow_mut().authority, owner.key());

    assign!(election.borrow_mut().title, title);

    assign!(election.borrow_mut().is_active, true);

    solana_program::msg!("{}", format!("Election created by {:?}", owner.key()));
}

pub fn register_voter_handler<'info>(
    mut payer: SeahorseSigner<'info, '_>,
    mut voter: Empty<Mutable<LoadedVoter<'info, '_>>>,
    mut election: Mutable<LoadedElection<'info, '_>>,
) -> () {
    let mut voter = voter.account.clone();

    assign!(voter.borrow_mut().authority, payer.key());

    assign!(
        voter.borrow_mut().election,
        election.borrow().__account__.key()
    );

    assign!(voter.borrow_mut().has_voted, false);

    solana_program::msg!("{}", format!("Voter registered: {:?}", payer.key()));
}
