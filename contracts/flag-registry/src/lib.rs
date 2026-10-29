//! Gideon community flag registry.
//!
//! Anyone can flag a NEAR account they believe is a scam or address-poisoning
//! account, with a short reason. Each reporter can flag an account once, and
//! pays for the storage their flag uses (the rest of the deposit is refunded).
//! A reporter can withdraw their own flag and get that storage deposit back.
//!
//! There is no owner and no admin method. Nothing can be edited or removed by
//! anyone except the reporter of a flag. Flags are reports, not proof: Gideon
//! shows them as "look again" and never blocks a send on flags alone.

use near_sdk::store::LookupMap;
use near_sdk::{AccountId, BorshStorageKey, NearToken, Promise, env, near, require};

/// Longest reason accepted, in bytes.
pub const MAX_REASON_LEN: usize = 280;
/// Most flags kept per account. Keeps `get_flags` and `report` cheap.
pub const MAX_FLAGS_PER_ACCOUNT: usize = 100;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Flag {
    pub reporter: AccountId,
    pub reason: String,
    /// Block timestamp of the report, in milliseconds.
    pub at_ms: u64,
}

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Flags,
}

#[near(contract_state)]
pub struct FlagRegistry {
    flags: LookupMap<AccountId, Vec<Flag>>,
}

impl Default for FlagRegistry {
    fn default() -> Self {
        Self { flags: LookupMap::new(Key::Flags) }
    }
}

fn storage_cost(bytes: u64) -> NearToken {
    env::storage_byte_cost().saturating_mul(bytes as u128)
}

#[near]
impl FlagRegistry {
    /// Flag `account_id` with a short `reason`. Attach enough NEAR to cover the
    /// storage (about 0.003 NEAR; 0.01 is always enough). The rest is refunded.
    /// Returns how many flags the account now has.
    #[payable]
    pub fn report(&mut self, account_id: AccountId, reason: String) -> u32 {
        let reporter = env::predecessor_account_id();
        require!(reporter != account_id, "You can't flag your own account");
        let reason = reason.trim().to_string();
        require!(!reason.is_empty(), "Give a reason");
        require!(reason.len() <= MAX_REASON_LEN, "Reason is longer than 280 bytes");

        let before = env::storage_usage();
        let list = self.flags.entry(account_id.clone()).or_default();
        require!(!list.iter().any(|f| f.reporter == reporter), "You already flagged this account");
        require!(list.len() < MAX_FLAGS_PER_ACCOUNT, "This account already has the maximum number of flags");
        list.push(Flag { reporter: reporter.clone(), reason, at_ms: env::block_timestamp_ms() });
        let count = list.len() as u32;
        self.flags.flush();

        let cost = storage_cost(env::storage_usage().saturating_sub(before));
        let attached = env::attached_deposit();
        require!(attached >= cost, format!("Attach at least {} yoctoNEAR to pay for storage", cost.as_yoctonear()));
        let refund = attached.saturating_sub(cost);
        if !refund.is_zero() {
            Promise::new(reporter.clone()).transfer(refund).detach();
        }
        env::log_str(&format!("flag: {reporter} flagged {account_id} ({count} total)"));
        count
    }

    /// Remove your own flag on `account_id` and get its storage deposit back.
    pub fn withdraw(&mut self, account_id: AccountId) -> u32 {
        let reporter = env::predecessor_account_id();
        let before = env::storage_usage();
        let Some(list) = self.flags.get_mut(&account_id) else { env::panic_str("You haven't flagged this account") };
        let Some(i) = list.iter().position(|f| f.reporter == reporter) else { env::panic_str("You haven't flagged this account") };
        list.remove(i);
        let count = list.len() as u32;
        if count == 0 {
            self.flags.remove(&account_id);
        }
        self.flags.flush();

        let refund = storage_cost(before.saturating_sub(env::storage_usage()));
        if !refund.is_zero() {
            Promise::new(reporter.clone()).transfer(refund).detach();
        }
        env::log_str(&format!("unflag: {reporter} withdrew their flag on {account_id} ({count} left)"));
        count
    }

    /// Every flag on `account_id`, oldest first. Empty when there are none.
    pub fn get_flags(&self, account_id: AccountId) -> Vec<Flag> {
        self.flags.get(&account_id).cloned().unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn ctx(who: &str, deposit: NearToken) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(who.parse().unwrap())
            .attached_deposit(deposit)
            .build());
    }
    const DEP: NearToken = NearToken::from_millinear(10);

    #[test]
    fn report_and_read() {
        let mut c = FlagRegistry::default();
        ctx("alice.testnet", DEP);
        assert_eq!(c.report("scam.testnet".parse().unwrap(), "  poisoned my history ".into()), 1);
        ctx("bob.testnet", DEP);
        assert_eq!(c.report("scam.testnet".parse().unwrap(), "dust from lookalike".into()), 2);
        let flags = c.get_flags("scam.testnet".parse().unwrap());
        assert_eq!(flags.len(), 2);
        assert_eq!(flags[0].reporter.as_str(), "alice.testnet");
        assert_eq!(flags[0].reason, "poisoned my history");
        assert!(c.get_flags("nobody.testnet".parse().unwrap()).is_empty());
    }

    #[test]
    #[should_panic(expected = "You already flagged this account")]
    fn one_flag_per_reporter() {
        let mut c = FlagRegistry::default();
        ctx("alice.testnet", DEP);
        c.report("scam.testnet".parse().unwrap(), "a".into());
        c.report("scam.testnet".parse().unwrap(), "b".into());
    }

    #[test]
    #[should_panic(expected = "You can't flag your own account")]
    fn no_self_flag() {
        let mut c = FlagRegistry::default();
        ctx("alice.testnet", DEP);
        c.report("alice.testnet".parse().unwrap(), "a".into());
    }

    #[test]
    #[should_panic(expected = "Give a reason")]
    fn empty_reason() {
        let mut c = FlagRegistry::default();
        ctx("alice.testnet", DEP);
        c.report("scam.testnet".parse().unwrap(), "   ".into());
    }

    #[test]
    #[should_panic(expected = "longer than 280")]
    fn long_reason() {
        let mut c = FlagRegistry::default();
        ctx("alice.testnet", DEP);
        c.report("scam.testnet".parse().unwrap(), "x".repeat(281));
    }

    #[test]
    #[should_panic(expected = "to pay for storage")]
    fn needs_deposit() {
        let mut c = FlagRegistry::default();
        ctx("alice.testnet", NearToken::from_yoctonear(0));
        c.report("scam.testnet".parse().unwrap(), "a".into());
    }

    #[test]
    fn withdraw_own_flag() {
        let mut c = FlagRegistry::default();
        ctx("alice.testnet", DEP);
        c.report("scam.testnet".parse().unwrap(), "a".into());
        ctx("bob.testnet", DEP);
        c.report("scam.testnet".parse().unwrap(), "b".into());
        ctx("alice.testnet", NearToken::from_yoctonear(0));
        assert_eq!(c.withdraw("scam.testnet".parse().unwrap()), 1);
        let flags = c.get_flags("scam.testnet".parse().unwrap());
        assert_eq!(flags.len(), 1);
        assert_eq!(flags[0].reporter.as_str(), "bob.testnet");
    }

    #[test]
    #[should_panic(expected = "You haven't flagged this account")]
    fn cannot_withdraw_others_flag() {
        let mut c = FlagRegistry::default();
        ctx("alice.testnet", DEP);
        c.report("scam.testnet".parse().unwrap(), "a".into());
        ctx("mallory.testnet", NearToken::from_yoctonear(0));
        c.withdraw("scam.testnet".parse().unwrap());
    }
}
