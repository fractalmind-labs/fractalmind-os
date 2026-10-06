/// FractalMind Protocol — Bootstrap
/// One-Time Witness pattern: creates ProtocolRegistry at publish.
module fractalmind_protocol::bootstrap {
    use sui::tx_context::TxContext;

    use fractalmind_protocol::organization;
    use fractalmind_protocol::identity;

    /// OTW — must be uppercase module name.
    public struct BOOTSTRAP has drop {}

    fun init(_witness: BOOTSTRAP, ctx: &mut TxContext) {
        // A new product deployment is usable atomically at publish. Upgrades
        // retain initialize_registry for registries from older deployments.
        let mut registry = organization::new_registry(ctx);
        identity::initialize_registry(&mut registry, ctx);
        organization::share_registry(registry);
    }
}
