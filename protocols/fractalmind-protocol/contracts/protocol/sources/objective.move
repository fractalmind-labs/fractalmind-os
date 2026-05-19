/// FractalMind Protocol — Objective / OKR control plane
/// Minimal Sui-native Objective → KeyResult → KRReview model.
module fractalmind_protocol::objective {
    use sui::object::{Self, ID, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::event;
    use std::string::String;
    use std::option::{Self, Option};

    use fractalmind_protocol::constants;
    use fractalmind_protocol::organization::{Self, Organization, OrgAdminCap};

    // ===== Error Codes (83xx) =====

    const E_EMPTY_TITLE: u64 = 8301;
    const E_INVALID_HASH: u64 = 8302;
    const E_INVALID_DEADLINE: u64 = 8303;
    const E_INVALID_STATUS: u64 = 8304;
    const E_OBJECTIVE_CLOSED: u64 = 8305;
    const E_KR_OBJECTIVE_MISMATCH: u64 = 8306;

    const HASH_BYTES: u64 = 32;

    const OBJECTIVE_STATUS_OPEN: u8 = 0;
    const OBJECTIVE_STATUS_CLOSED: u8 = 1;

    const KR_STATUS_OPEN: u8 = 0;
    const KR_STATUS_ACCEPTED: u8 = 1;
    const KR_STATUS_NEEDS_CHANGES: u8 = 2;
    const KR_STATUS_REJECTED: u8 = 3;

    const KR_VERDICT_PASS: u8 = 1;
    const KR_VERDICT_FAIL: u8 = 2;
    const KR_VERDICT_NEEDS_CHANGES: u8 = 3;

    // ===== Structs =====

    public struct Objective has key {
        id: UID,
        org_id: ID,
        owner: address,
        title: String,
        description_hash: vector<u8>,
        status: u8,
        deadline_ms: u64,
        key_result_count: u64,
        created_at_ms: u64,
        closed_at_ms: Option<u64>,
    }

    public struct KeyResult has key {
        id: UID,
        org_id: ID,
        objective_id: ID,
        title: String,
        target_hash: vector<u8>,
        status: u8,
        created_at_ms: u64,
        accepted_at_ms: Option<u64>,
        task_count: u64,
        review_count: u64,
    }

    public struct KRReview has key {
        id: UID,
        org_id: ID,
        objective_id: ID,
        key_result_id: ID,
        reviewer: address,
        verdict: u8,
        evidence_hash: vector<u8>,
        created_at_ms: u64,
    }

    // ===== Events =====

    public struct ObjectiveCreated has copy, drop {
        objective_id: ID,
        org_id: ID,
        owner: address,
        title: String,
        description_hash: vector<u8>,
        deadline_ms: u64,
    }

    public struct KeyResultCreated has copy, drop {
        key_result_id: ID,
        objective_id: ID,
        org_id: ID,
        title: String,
        target_hash: vector<u8>,
    }

    public struct KeyResultReviewed has copy, drop {
        review_id: ID,
        key_result_id: ID,
        objective_id: ID,
        org_id: ID,
        reviewer: address,
        verdict: u8,
        evidence_hash: vector<u8>,
    }

    public struct KeyResultAccepted has copy, drop {
        key_result_id: ID,
        objective_id: ID,
        org_id: ID,
        reviewer: address,
        evidence_hash: vector<u8>,
    }

    public struct ObjectiveClosed has copy, drop {
        objective_id: ID,
        org_id: ID,
        closed_by: address,
    }

    // ===== Public Functions =====

    public fun create_objective(
        admin_cap: &OrgAdminCap,
        org: &Organization,
        title: String,
        description_hash: vector<u8>,
        deadline_ms: u64,
        ctx: &mut TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        let now = tx_context::epoch_timestamp_ms(ctx);
        let org_id = organization::org_id(org);

        assert!(organization::admin_cap_org_id(admin_cap) == org_id, constants::e_not_admin());
        assert!(organization::is_active(org), constants::e_org_not_active());
        assert!(std::string::length(&title) > 0, E_EMPTY_TITLE);
        assert!(vector::length(&description_hash) == HASH_BYTES, E_INVALID_HASH);
        assert!(deadline_ms > now, E_INVALID_DEADLINE);

        let objective = Objective {
            id: object::new(ctx),
            org_id,
            owner: sender,
            title,
            description_hash,
            status: OBJECTIVE_STATUS_OPEN,
            deadline_ms,
            key_result_count: 0,
            created_at_ms: now,
            closed_at_ms: option::none(),
        };
        let objective_id = object::id(&objective);

        event::emit(ObjectiveCreated {
            objective_id,
            org_id,
            owner: sender,
            title: objective.title,
            description_hash: objective.description_hash,
            deadline_ms,
        });

        transfer::share_object(objective);
    }

    public fun create_key_result(
        admin_cap: &OrgAdminCap,
        objective: &mut Objective,
        title: String,
        target_hash: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(organization::admin_cap_org_id(admin_cap) == objective.org_id, constants::e_not_admin());
        assert!(objective.status == OBJECTIVE_STATUS_OPEN, E_OBJECTIVE_CLOSED);
        assert!(std::string::length(&title) > 0, E_EMPTY_TITLE);
        assert!(vector::length(&target_hash) == HASH_BYTES, E_INVALID_HASH);

        let kr = KeyResult {
            id: object::new(ctx),
            org_id: objective.org_id,
            objective_id: object::id(objective),
            title,
            target_hash,
            status: KR_STATUS_OPEN,
            created_at_ms: tx_context::epoch_timestamp_ms(ctx),
            accepted_at_ms: option::none(),
            task_count: 0,
            review_count: 0,
        };
        let key_result_id = object::id(&kr);
        objective.key_result_count = objective.key_result_count + 1;

        event::emit(KeyResultCreated {
            key_result_id,
            objective_id: object::id(objective),
            org_id: objective.org_id,
            title: kr.title,
            target_hash: kr.target_hash,
        });

        transfer::share_object(kr);
    }

    public fun review_key_result(
        admin_cap: &OrgAdminCap,
        objective: &Objective,
        key_result: &mut KeyResult,
        verdict: u8,
        evidence_hash: vector<u8>,
        ctx: &mut TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        assert!(organization::admin_cap_org_id(admin_cap) == key_result.org_id, constants::e_not_admin());
        assert!(key_result.objective_id == object::id(objective), E_KR_OBJECTIVE_MISMATCH);
        assert!(objective.org_id == key_result.org_id, constants::e_unauthorized());
        assert!(objective.status == OBJECTIVE_STATUS_OPEN, E_OBJECTIVE_CLOSED);
        assert!(key_result.status != KR_STATUS_ACCEPTED, E_INVALID_STATUS);
        assert!(is_valid_verdict(verdict), E_INVALID_STATUS);
        assert!(vector::length(&evidence_hash) == HASH_BYTES, E_INVALID_HASH);

        let review = KRReview {
            id: object::new(ctx),
            org_id: key_result.org_id,
            objective_id: key_result.objective_id,
            key_result_id: object::id(key_result),
            reviewer: sender,
            verdict,
            evidence_hash,
            created_at_ms: tx_context::epoch_timestamp_ms(ctx),
        };
        let review_id = object::id(&review);
        key_result.review_count = key_result.review_count + 1;
        if (verdict == KR_VERDICT_PASS) {
            key_result.status = KR_STATUS_ACCEPTED;
            key_result.accepted_at_ms = option::some(tx_context::epoch_timestamp_ms(ctx));
        } else if (verdict == KR_VERDICT_NEEDS_CHANGES) {
            key_result.status = KR_STATUS_NEEDS_CHANGES;
        } else {
            key_result.status = KR_STATUS_REJECTED;
        };

        event::emit(KeyResultReviewed {
            review_id,
            key_result_id: object::id(key_result),
            objective_id: key_result.objective_id,
            org_id: key_result.org_id,
            reviewer: sender,
            verdict,
            evidence_hash: review.evidence_hash,
        });

        transfer::share_object(review);
    }

    public fun accept_key_result(
        admin_cap: &OrgAdminCap,
        objective: &Objective,
        key_result: &mut KeyResult,
        evidence_hash: vector<u8>,
        ctx: &mut TxContext,
    ) {
        review_key_result(admin_cap, objective, key_result, KR_VERDICT_PASS, evidence_hash, ctx);
        event::emit(KeyResultAccepted {
            key_result_id: object::id(key_result),
            objective_id: key_result.objective_id,
            org_id: key_result.org_id,
            reviewer: tx_context::sender(ctx),
            evidence_hash,
        });
    }

    public fun close_objective(
        admin_cap: &OrgAdminCap,
        objective: &mut Objective,
        ctx: &TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        assert!(organization::admin_cap_org_id(admin_cap) == objective.org_id, constants::e_not_admin());
        assert!(objective.status == OBJECTIVE_STATUS_OPEN, E_OBJECTIVE_CLOSED);

        objective.status = OBJECTIVE_STATUS_CLOSED;
        objective.closed_at_ms = option::some(tx_context::epoch_timestamp_ms(ctx));

        event::emit(ObjectiveClosed {
            objective_id: object::id(objective),
            org_id: objective.org_id,
            closed_by: sender,
        });
    }

    public fun increment_key_result_task_count(key_result: &mut KeyResult) {
        key_result.task_count = key_result.task_count + 1;
    }

    fun is_valid_verdict(verdict: u8): bool {
        verdict == KR_VERDICT_PASS || verdict == KR_VERDICT_FAIL || verdict == KR_VERDICT_NEEDS_CHANGES
    }

    // ===== Query Functions =====

    public fun objective_id(objective: &Objective): ID { object::id(objective) }
    public fun objective_org_id(objective: &Objective): ID { objective.org_id }
    public fun objective_owner(objective: &Objective): address { objective.owner }
    public fun objective_title(objective: &Objective): String { objective.title }
    public fun objective_status(objective: &Objective): u8 { objective.status }
    public fun objective_key_result_count(objective: &Objective): u64 { objective.key_result_count }
    public fun key_result_id(key_result: &KeyResult): ID { object::id(key_result) }
    public fun key_result_org_id(key_result: &KeyResult): ID { key_result.org_id }
    public fun key_result_objective_id(key_result: &KeyResult): ID { key_result.objective_id }
    public fun key_result_status(key_result: &KeyResult): u8 { key_result.status }
    public fun key_result_task_count(key_result: &KeyResult): u64 { key_result.task_count }
    public fun key_result_review_count(key_result: &KeyResult): u64 { key_result.review_count }
    public fun kr_review_verdict(review: &KRReview): u8 { review.verdict }
    public fun objective_status_open(): u8 { OBJECTIVE_STATUS_OPEN }
    public fun objective_status_closed(): u8 { OBJECTIVE_STATUS_CLOSED }
    public fun kr_status_open(): u8 { KR_STATUS_OPEN }
    public fun kr_status_accepted(): u8 { KR_STATUS_ACCEPTED }
    public fun kr_status_needs_changes(): u8 { KR_STATUS_NEEDS_CHANGES }
    public fun kr_status_rejected(): u8 { KR_STATUS_REJECTED }
    public fun kr_verdict_pass(): u8 { KR_VERDICT_PASS }
    public fun kr_verdict_fail(): u8 { KR_VERDICT_FAIL }
    public fun kr_verdict_needs_changes(): u8 { KR_VERDICT_NEEDS_CHANGES }
}
