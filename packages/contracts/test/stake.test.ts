import type { Artifacts } from 'hardhat/types';
import type Web3 from 'web3';
import { assert, expect } from 'chai';
import { BN, MAX_INTEGER } from 'ethereumjs-util';

declare var artifacts: Artifacts;
declare var web3: Web3;

const Config = artifacts.require('Config');
const Share = artifacts.require('Share');
const StakeManager = artifacts.require('StakeManager');

describe('StakeManger', () => {
  let config: any;
  let stakeManager: any;
  let deployer: string;
  let validator: string;
  let receiver: string;

  async function createShareContract(validator: string, isStake = true) {
    const address = isStake ? await stakeManager.methods.validatorToShare(validator).call() : await stakeManager.methods.validatorToUnstakeShare(validator).call();
    return new web3.eth.Contract(Share.abi, address, { from: deployer });
  }

  function toBN(data: number | string) {
    if (typeof data === 'string' && data.startsWith('0x')) {
      return new BN(data.substr(2), 'hex');
    }
    return new BN(data);
  }

  before(async () => {
    const accounts = await web3.eth.getAccounts();
    deployer = accounts[0];
    validator = accounts[1];
    receiver = accounts[2];
  });

  it('should deploy succeed', async () => {
    config = new web3.eth.Contract(Config.abi, (await Config.new()).address, { from: deployer });
    stakeManager = new web3.eth.Contract(StakeManager.abi, (await StakeManager.new(config.options.address)).address, { from: deployer });
    await config.methods.setStakeManager(stakeManager.options.address).send();
  });

  it('should initialize succeed', async () => {
    expect(await stakeManager.methods.firstId().call(), 'firstId should be equal to 0').to.equal('0');
    expect(await stakeManager.methods.lastId().call(), 'lastId should be equal to 0').to.equal('0');
    expect(await stakeManager.methods.validatorsLength().call(), 'validatorsLength should be equal to 0').to.equal('0');
  });

  it('should stake failed(min stake amount)', async () => {
    const minStakeAmount = toBN(await config.methods.minStakeAmount().call());
    try {
      await stakeManager.methods.stake(validator, deployer).send({ value: minStakeAmount.subn(1).toString() });
      assert.fail("shouldn't stake succeed");
    } catch (err) {}
  });

  it('should stake succeed', async () => {
    const minStakeAmount = toBN(await config.methods.minStakeAmount().call());
    await stakeManager.methods.stake(validator, deployer).send({ value: minStakeAmount.toString() });
    const shares = await (await createShareContract(validator)).methods.balanceOf(deployer).call();
    expect(shares, 'shares should be equal to amount at the time of the first staking').to.equal(minStakeAmount.toString());
  });

  it('should match validator info', async () => {
    const share = await createShareContract(validator);
    expect(await share.methods.validator().call(), 'validator address should be equal').to.equal(validator);
    expect(await share.methods.isStake().call(), 'should be stake share contract').be.true;
    const unstakeShare = await createShareContract(validator, false);
    expect(await unstakeShare.methods.validator().call(), 'validator address should be equal').to.equal(validator);
    expect(await unstakeShare.methods.isStake().call(), 'should be unstake share contract').be.false;
  });

  it('should approve succeed', async () => {
    const share = await createShareContract(validator);
    await share.methods.approve(stakeManager.options.address, MAX_INTEGER.toString()).send();
  });

  it('should unstake succeed', async () => {
    const unstakeDelay = toBN(await config.methods.unstakeDelay().call()).toNumber();
    const minUnstakeShares = toBN(await stakeManager.methods.estimateMinUnstakeShares(validator).call());

    const share = await createShareContract(validator);
    const shrBeforeUnstake = toBN(await share.methods.balanceOf(deployer).call());
    await stakeManager.methods.startUnstake(validator, receiver, minUnstakeShares.toString()).send();
    const shrAfterUnstake = toBN(await share.methods.balanceOf(deployer).call());

    expect(shrBeforeUnstake.sub(minUnstakeShares).toString(), 'shares should be equal').to.equal(shrAfterUnstake.toString());
    expect(await share.methods.totalSupply().call(), 'total supply should be equal').to.equal(shrAfterUnstake.toString());

    // sleep until unstake delay
    await new Promise((r) => setTimeout(r, unstakeDelay * 1000 + 10));

    // send a transaction to update blockchain timestamp
    await web3.eth.sendTransaction({
      from: deployer,
      to: deployer,
      value: 0
    });

    // the unstake id should be `0`, so we directly use `0` to get `unstakeShares`
    const unstakeShares = (await stakeManager.methods.unstakeQueue(0).call()).unstakeShares;
    const estimateUnstakeAmount = toBN(await stakeManager.methods.estimateUnstakeAmount(validator, unstakeShares).call());
    const balBeforeUnstake = toBN(await web3.eth.getBalance(receiver));
    await stakeManager.methods.doUnstake().send();
    const balAfterUnstake = toBN(await web3.eth.getBalance(receiver));

    expect(balBeforeUnstake.add(estimateUnstakeAmount).toString(), 'receiver balance should be equal to the estimated value').to.equal(balAfterUnstake.toString());
  });
});
