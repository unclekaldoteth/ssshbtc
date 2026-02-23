#[starknet::contract]
pub mod VerifierAdapter {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};

    use crate::interfaces::{IVerifierDispatcher, IVerifierDispatcherTrait};

    #[storage]
    struct Storage {
        admin: ContractAddress,
        verifier: ContractAddress,
        mock_mode: bool,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        VerifierUpdated: VerifierUpdated,
        MockModeUpdated: MockModeUpdated,
    }

    #[derive(Drop, starknet::Event)]
    struct VerifierUpdated {
        old_verifier: ContractAddress,
        new_verifier: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct MockModeUpdated {
        enabled: bool,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState, verifier: ContractAddress, mock_mode: bool, admin: ContractAddress
    ) {
        self.admin.write(admin);
        self.verifier.write(verifier);
        self.mock_mode.write(mock_mode);
    }

    #[external(v0)]
    fn set_verifier(ref self: ContractState, verifier: ContractAddress) {
        let caller = get_caller_address();
        assert(caller == self.admin.read(), 'ONLY_ADMIN');

        let old_verifier = self.verifier.read();
        self.verifier.write(verifier);

        self
            .emit(
                Event::VerifierUpdated(VerifierUpdated { old_verifier: old_verifier, new_verifier: verifier })
            );
    }

    #[external(v0)]
    fn set_mock_mode(ref self: ContractState, enabled: bool) {
        let caller = get_caller_address();
        assert(caller == self.admin.read(), 'ONLY_ADMIN');

        self.mock_mode.write(enabled);
        self.emit(Event::MockModeUpdated(MockModeUpdated { enabled: enabled }));
    }

    #[external(v0)]
    fn get_verifier(self: @ContractState) -> ContractAddress {
        self.verifier.read()
    }

    #[external(v0)]
    fn is_mock_mode(self: @ContractState) -> bool {
        self.mock_mode.read()
    }

    #[external(v0)]
    fn verify_proof(self: @ContractState, proof: Span<felt252>, public_inputs: Span<felt252>) -> bool {
        if self.mock_mode.read() {
            return proof.len() > 0_usize && public_inputs.len() > 0_usize;
        }

        let verifier = IVerifierDispatcher { contract_address: self.verifier.read() };
        verifier.verify(proof, public_inputs)
    }
}
