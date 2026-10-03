#[test_only]
module fractalmind_protocol::extension_attack {
    /// A seal created in a different package must never authenticate as either
    /// product extension, even when the caller is a valid organization owner.
    public struct Impostor has drop {}
    public fun seal(): Impostor { Impostor {} }
}
