//! Runs the built contract on a local near-sandbox node (no testnet, no keys of yours).
use near_api::{AccountId, NearToken, NetworkConfig, Signer};
use near_sdk::serde_json::json;
use std::sync::Arc;

#[derive(near_sdk::serde::Deserialize, Debug)]
#[serde(crate = "near_sdk::serde")]
struct Flag {
    reporter: AccountId,
    reason: String,
}

async fn account(sandbox: &near_sandbox::Sandbox, name: &str) -> testresult::TestResult<AccountId> {
    let id: AccountId = name.parse()?;
    sandbox.create_account(name.parse()?).initial_balance(NearToken::from_near(10)).send().await?;
    Ok(id)
}

#[tokio::test]
async fn flag_registry_on_sandbox() -> testresult::TestResult<()> {
    let wasm = std::fs::read(cargo_near_build::build_with_cli(Default::default())?)?;
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer: Arc<Signer> = Signer::from_secret_key(near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?)?;

    let registry = account(&sandbox, "flags.sandbox").await?;
    let alice = account(&sandbox, "alice.sandbox").await?;
    let bob = account(&sandbox, "bob.sandbox").await?;
    let scam = account(&sandbox, "scam.sandbox").await?;

    // No init call: the contract has no owner and starts empty.
    near_api::Contract::deploy(registry.clone())
        .use_code(wasm)
        .without_init_call()
        .with_signer(signer.clone())
        .send_to(&net)
        .await?
        .assert_success();
    let contract = near_api::Contract(registry.clone());

    let report = |who: &AccountId, target: &AccountId, reason: &str, deposit: NearToken| {
        contract
            .call_function("report", json!({ "account_id": target, "reason": reason }))
            .transaction()
            .deposit(deposit)
            .with_signer(who.clone(), signer.clone())
    };
    let flags = || async {
        contract
            .call_function("get_flags", json!({ "account_id": scam }))
            .read_only::<Vec<Flag>>()
            .fetch_from(&net)
            .await
            .map(|r| r.data)
    };

    assert!(flags().await?.is_empty());

    let before = near_api::Tokens::account(alice.clone()).near_balance().fetch_from(&net).await?.total;
    report(&alice, &scam, "sent me dust from a lookalike", NearToken::from_millinear(10)).send_to(&net).await?.assert_success();
    let after = near_api::Tokens::account(alice.clone()).near_balance().fetch_from(&net).await?.total;
    // Only storage (and gas) is kept: well under the 0.01 NEAR attached.
    let spent = before.saturating_sub(after);
    assert!(spent < NearToken::from_millinear(6), "alice spent {spent}");

    // Anti-spam: one flag per reporter per account.
    report(&alice, &scam, "again", NearToken::from_millinear(10)).send_to(&net).await?.assert_failure();
    // No deposit, no flag.
    report(&bob, &scam, "no deposit", NearToken::from_yoctonear(0)).send_to(&net).await?.assert_failure();
    // Nobody flags themselves.
    report(&bob, &bob, "me", NearToken::from_millinear(10)).send_to(&net).await?.assert_failure();

    report(&bob, &scam, "poisoning", NearToken::from_millinear(10)).send_to(&net).await?.assert_success();
    let f = flags().await?;
    assert_eq!(f.len(), 2);
    assert_eq!(f[0].reporter, alice);
    assert_eq!(f[0].reason, "sent me dust from a lookalike");
    assert_eq!(f[1].reporter, bob);

    // Only the reporter can withdraw their flag.
    contract
        .call_function("withdraw", json!({ "account_id": scam }))
        .transaction()
        .with_signer(registry.clone(), signer.clone())
        .send_to(&net)
        .await?
        .assert_failure();
    contract
        .call_function("withdraw", json!({ "account_id": scam }))
        .transaction()
        .with_signer(alice.clone(), signer.clone())
        .send_to(&net)
        .await?
        .assert_success();
    let f = flags().await?;
    assert_eq!(f.len(), 1);
    assert_eq!(f[0].reporter, bob);
    Ok(())
}
