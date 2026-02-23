use starknet::ContractAddress;

#[starknet::interface]
pub trait IERC20<TContractState> {
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256);
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256
    );
}

#[starknet::interface]
pub trait IVerifier<TContractState> {
    fn verify(self: @TContractState, proof: Span<felt252>, public_inputs: Span<felt252>) -> bool;
}

#[starknet::interface]
pub trait IVerifierAdapter<TContractState> {
    fn verify_proof(
        self: @TContractState, proof: Span<felt252>, public_inputs: Span<felt252>
    ) -> bool;
}
