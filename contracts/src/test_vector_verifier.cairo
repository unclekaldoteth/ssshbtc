#[starknet::contract]
pub mod TestVectorVerifier {
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};

    #[storage]
    struct Storage {
        admin: ContractAddress,
        allowed_digests: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        DigestRegistered: DigestRegistered,
        DigestRevoked: DigestRevoked,
    }

    #[derive(Drop, starknet::Event)]
    struct DigestRegistered {
        digest: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct DigestRevoked {
        digest: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.admin.write(admin);
    }

    #[external(v0)]
    fn register_digest(ref self: ContractState, digest: felt252) {
        assert(get_caller_address() == self.admin.read(), 'ONLY_ADMIN');
        self.allowed_digests.write(digest, true);
        self.emit(Event::DigestRegistered(DigestRegistered { digest }));
    }

    #[external(v0)]
    fn revoke_digest(ref self: ContractState, digest: felt252) {
        assert(get_caller_address() == self.admin.read(), 'ONLY_ADMIN');
        self.allowed_digests.write(digest, false);
        self.emit(Event::DigestRevoked(DigestRevoked { digest }));
    }

    #[external(v0)]
    fn is_digest_allowed(self: @ContractState, digest: felt252) -> bool {
        self.allowed_digests.read(digest)
    }

    #[external(v0)]
    fn verify(self: @ContractState, proof: Span<felt252>, public_inputs: Span<felt252>) -> bool {
        let digest = compute_digest(proof, public_inputs);
        self.allowed_digests.read(digest)
    }

    fn compute_digest(proof: Span<felt252>, public_inputs: Span<felt252>) -> felt252 {
        let mut acc: felt252 = 0;

        for p in proof {
            acc = acc + *p;
        }

        for input in public_inputs {
            acc = acc + *input;
        }

        acc
    }
}
