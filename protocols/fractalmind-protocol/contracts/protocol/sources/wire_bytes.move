/// Assemble bounded byte payloads inside one PTB. Sui limits each pure input
/// to 16 KiB even when the final object can hold a larger encrypted body.
module fractalmind_protocol::wire_bytes {
    const E_SIZE: u64 = 9151;
    public fun append_bytes(mut left: vector<u8>, right: vector<u8>): vector<u8> {
        assert!(vector::length(&left) + vector::length(&right) <= 65536, E_SIZE);
        vector::append(&mut left, right);
        left
    }
}
