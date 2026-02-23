#[starknet::contract]
pub mod ShieldedPool {
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_contract_address};

    use crate::interfaces::{
        IERC20Dispatcher, IERC20DispatcherTrait, IVerifierAdapterDispatcher,
        IVerifierAdapterDispatcherTrait,
    };

    #[storage]
    struct Storage {
        owner: ContractAddress,
        verifier_adapter: ContractAddress,
        commitment_count: u64,
        current_root: felt252,
        commitments: Map<u64, felt252>,
        nullifiers: Map<felt252, bool>,
        known_roots: Map<felt252, bool>,
        note_cipher_hashes: Map<felt252, felt252>,
        allowed_assets: Map<ContractAddress, bool>,
        view_keys: Map<ContractAddress, felt252>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        CommitmentInserted: CommitmentInserted,
        NullifierUsed: NullifierUsed,
        PrivateTransfer: PrivateTransfer,
        Withdrawal: Withdrawal,
        ViewKeyRegistered: ViewKeyRegistered,
        AssetWhitelisted: AssetWhitelisted,
    }

    #[derive(Drop, starknet::Event)]
    struct CommitmentInserted {
        commitment: felt252,
        index: u64,
        root: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct NullifierUsed {
        nullifier: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct PrivateTransfer {
        root: felt252,
        fee_asset: ContractAddress,
        fee_amount_commitment: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct Withdrawal {
        recipient: ContractAddress,
        commitment_ref: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct ViewKeyRegistered {
        owner: ContractAddress,
        pubkey: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct AssetWhitelisted {
        asset: ContractAddress,
        enabled: bool,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState, owner: ContractAddress, verifier_adapter: ContractAddress, initial_root: felt252
    ) {
        self.owner.write(owner);
        self.verifier_adapter.write(verifier_adapter);
        self.current_root.write(initial_root);
        self.known_roots.write(initial_root, true);
    }

    #[external(v0)]
    fn whitelist_asset(ref self: ContractState, asset: ContractAddress, enabled: bool) {
        assert(get_caller_address() == self.owner.read(), 'ONLY_OWNER');

        self.allowed_assets.write(asset, enabled);
        self.emit(Event::AssetWhitelisted(AssetWhitelisted { asset, enabled }));
    }

    #[external(v0)]
    fn register_view_key(ref self: ContractState, pubkey: felt252) {
        let caller = get_caller_address();
        self.view_keys.write(caller, pubkey);
        self.emit(Event::ViewKeyRegistered(ViewKeyRegistered { owner: caller, pubkey }));
    }

    #[external(v0)]
    fn deposit(
        ref self: ContractState,
        asset: ContractAddress,
        amount: u256,
        commitment: felt252,
        encrypted_note: felt252,
    ) {
        assert(self.allowed_assets.read(asset), 'ASSET_NOT_ALLOWED');

        let token = IERC20Dispatcher { contract_address: asset };
        token.transfer_from(get_caller_address(), get_contract_address(), amount);

        insert_commitment(ref self, commitment, encrypted_note);
    }

    #[external(v0)]
    fn transact(
        ref self: ContractState,
        proof: Span<felt252>,
        public_inputs: Span<felt252>,
        new_commitments: Span<felt252>,
        new_encrypted_notes: Span<felt252>,
        nullifiers: Span<felt252>,
        merkle_root: felt252,
        fee_asset: ContractAddress,
        fee_amount_commitment: felt252,
    ) {
        assert(self.known_roots.read(merkle_root), 'UNKNOWN_ROOT');
        assert(new_commitments.len() == new_encrypted_notes.len(), 'MISMATCHED_OUTPUTS');

        let verifier = IVerifierAdapterDispatcher { contract_address: self.verifier_adapter.read() };
        assert(verifier.verify_proof(proof, public_inputs), 'INVALID_PROOF');

        for nullifier in nullifiers {
            assert(!self.nullifiers.read(*nullifier), 'NULLIFIER_USED');
            self.nullifiers.write(*nullifier, true);
            self.emit(Event::NullifierUsed(NullifierUsed { nullifier: *nullifier }));
        }

        let mut index = 0_usize;
        loop {
            if index >= new_commitments.len() {
                break;
            }

            let commitment = *new_commitments.at(index);
            let encrypted_note = *new_encrypted_notes.at(index);
            insert_commitment(ref self, commitment, encrypted_note);

            index += 1;
        };

        self
            .emit(
                Event::PrivateTransfer(
                    PrivateTransfer {
                        root: self.current_root.read(),
                        fee_asset,
                        fee_amount_commitment,
                    }
                )
            );
    }

    #[external(v0)]
    fn withdraw(
        ref self: ContractState,
        proof: Span<felt252>,
        public_inputs: Span<felt252>,
        nullifiers: Span<felt252>,
        recipient_l2_or_l1: ContractAddress,
        amount: u256,
        amount_commitment: felt252,
        asset: ContractAddress,
        merkle_root: felt252,
    ) {
        assert(self.known_roots.read(merkle_root), 'UNKNOWN_ROOT');
        assert(self.allowed_assets.read(asset), 'ASSET_NOT_ALLOWED');

        let verifier = IVerifierAdapterDispatcher { contract_address: self.verifier_adapter.read() };
        assert(verifier.verify_proof(proof, public_inputs), 'INVALID_PROOF');

        for nullifier in nullifiers {
            assert(!self.nullifiers.read(*nullifier), 'NULLIFIER_USED');
            self.nullifiers.write(*nullifier, true);
            self.emit(Event::NullifierUsed(NullifierUsed { nullifier: *nullifier }));
        }

        let token = IERC20Dispatcher { contract_address: asset };
        token.transfer(recipient_l2_or_l1, amount);

        self
            .emit(
                Event::Withdrawal(
                    Withdrawal { recipient: recipient_l2_or_l1, commitment_ref: amount_commitment }
                )
            );
    }

    #[external(v0)]
    fn get_root(self: @ContractState) -> felt252 {
        self.current_root.read()
    }

    #[external(v0)]
    fn get_commitment(self: @ContractState, index: u64) -> felt252 {
        self.commitments.read(index)
    }

    #[external(v0)]
    fn get_commitment_count(self: @ContractState) -> u64 {
        self.commitment_count.read()
    }

    #[external(v0)]
    fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
        self.nullifiers.read(nullifier)
    }

    #[external(v0)]
    fn is_root_known(self: @ContractState, root: felt252) -> bool {
        self.known_roots.read(root)
    }

    #[external(v0)]
    fn get_note_cipher_hash(self: @ContractState, commitment: felt252) -> felt252 {
        self.note_cipher_hashes.read(commitment)
    }

    fn insert_commitment(ref self: ContractState, commitment: felt252, encrypted_note: felt252) {
        let idx = self.commitment_count.read();
        self.commitments.write(idx, commitment);
        self.note_cipher_hashes.write(commitment, encrypted_note);

        let next_idx = idx + 1;
        self.commitment_count.write(next_idx);

        let old_root = self.current_root.read();
        let new_root = old_root + commitment + idx.into();

        self.current_root.write(new_root);
        self.known_roots.write(new_root, true);

        self.emit(Event::CommitmentInserted(CommitmentInserted { commitment, index: idx, root: new_root }));
    }
}
