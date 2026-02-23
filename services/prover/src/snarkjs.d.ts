declare module "snarkjs" {
  interface Groth16Api {
    fullProve(
      input: Record<string, unknown>,
      wasmFile: string,
      zkeyFile: string
    ): Promise<{
      proof: Record<string, unknown>;
      publicSignals: string[];
    }>;
    verify(
      verificationKey: unknown,
      publicSignals: string[],
      proof: Record<string, unknown>
    ): Promise<boolean>;
  }

  interface SnarkjsModule {
    groth16: Groth16Api;
  }

  const snarkjs: SnarkjsModule;
  export default snarkjs;
}
