#[starknet::contract]
pub mod PaymentRequestRegistry {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address};

    #[derive(Drop, Serde, Copy, starknet::Store)]
    pub struct PaymentRequest {
        pub creator: ContractAddress,
        pub receiver_stealth_pubkey: felt252,
        pub expiry: u64,
        pub created_at: u64,
        pub paid: bool,
        pub tx_commitment_ref: felt252,
    }

    #[storage]
    struct Storage {
        requests: Map<felt252, PaymentRequest>,
        exists: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        PaymentRequestCreated: PaymentRequestCreated,
        PaymentRequestPaid: PaymentRequestPaid,
    }

    #[derive(Drop, starknet::Event)]
    struct PaymentRequestCreated {
        request_hash: felt252,
        creator: ContractAddress,
        expiry: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct PaymentRequestPaid {
        request_hash: felt252,
        tx_commitment_ref: felt252,
    }

    #[external(v0)]
    fn create_payment_request(
        ref self: ContractState,
        request_hash: felt252,
        receiver_stealth_pubkey: felt252,
        expiry: u64,
    ) {
        assert(!self.exists.read(request_hash), 'REQUEST_EXISTS');
        let now = get_block_timestamp();
        assert(expiry > now, 'INVALID_EXPIRY');

        let creator = get_caller_address();
        let created_at = now;

        self
            .requests
            .write(
                request_hash,
                PaymentRequest {
                    creator,
                    receiver_stealth_pubkey,
                    expiry,
                    created_at,
                    paid: false,
                    tx_commitment_ref: 0,
                }
            );
        self.exists.write(request_hash, true);

        self
            .emit(
                Event::PaymentRequestCreated(
                    PaymentRequestCreated { request_hash, creator, expiry }
                )
            );
    }

    #[external(v0)]
    fn mark_request_paid(ref self: ContractState, request_hash: felt252, tx_commitment_ref: felt252) {
        assert(self.exists.read(request_hash), 'REQUEST_NOT_FOUND');

        let request = self.requests.read(request_hash);
        assert(!request.paid, 'ALREADY_PAID');

        self
            .requests
            .write(
                request_hash,
                PaymentRequest {
                    creator: request.creator,
                    receiver_stealth_pubkey: request.receiver_stealth_pubkey,
                    expiry: request.expiry,
                    created_at: request.created_at,
                    paid: true,
                    tx_commitment_ref,
                }
            );

        self
            .emit(
                Event::PaymentRequestPaid(PaymentRequestPaid { request_hash, tx_commitment_ref })
            );
    }

    #[external(v0)]
    fn get_payment_request(self: @ContractState, request_hash: felt252) -> PaymentRequest {
        assert(self.exists.read(request_hash), 'REQUEST_NOT_FOUND');
        self.requests.read(request_hash)
    }
}
