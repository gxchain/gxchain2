import VM from '@ethereumjs/vm';
import Bloom from '@ethereumjs/vm/dist/bloom';
import runBlock, { RunBlockDebugOpts, RunBlockResult } from './runBlock';
import runCall, { RunCallDebugOpts } from './runCall';

/**
 * WrappedVM contains a evm, responsible for executing an EVM message fully
 * (including any nested calls and creates), processing the results and
 * storing them to state (or discarding changes in case of exceptions).
 */
export class WrappedVM {
  public readonly vm: VM;

  constructor(vm: VM) {
    this.vm = vm;
    // TODO: fix this.
    this.vm._common.removeAllListeners('hardforkChanged');
  }

  /**
   * Run block with options
   * @param opts - Options
   * @returns
   */
  async runBlock(opts: RunBlockDebugOpts): Promise<RunBlockResult> {
    await this.vm.init();
    return runBlock.bind(this.vm)(opts);
  }

  /**
   * Run call with options
   * @param opts - Options
   * @returns
   */
  async runCall(opts: RunCallDebugOpts) {
    await this.vm.init();
    return runCall.bind(this.vm)(opts);
  }
}

export { VM, Bloom };
export * from '@ethereumjs/vm/dist/evm/interpreter';
export * from '@ethereumjs/vm/dist/exceptions';
export * from './types';
export { DefaultStateManager as StateManager } from '@ethereumjs/vm/dist/state';
