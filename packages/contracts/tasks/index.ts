import { task } from 'hardhat/config';
import type { Artifacts } from 'hardhat/types';
import type Web3 from 'web3';
import { BN, MAX_INTEGER } from 'ethereumjs-util';

function toBN(data: number | string) {
  if (typeof data === 'string' && data.startsWith('0x')) {
    return new BN(data.substr(2), 'hex');
  }
  return new BN(data);
}

async function createWeb3Contract({ name, artifactName, address, deployments, web3, from, artifacts }: any) {
  const { get } = deployments;
  return new (web3 as Web3).eth.Contract((artifacts as Artifacts).require(artifactName ?? name).abi, address ?? (await get(name)).address, from ? { from } : undefined);
}

async function createEstimatorContract({ stakeManager, deployments, web3, from, artifacts }: any) {
  const address = await stakeManager.methods.estimator().call();
  return await createWeb3Contract({ name: 'Estimator', address, deployments, web3, from, artifacts });
}

task('accounts', 'List accounts').setAction(async (taskArgs, { web3 }) => {
  console.log(await web3.eth.getAccounts());
});

task('transfer', 'Transfer value to target address')
  .addParam('from', 'from address')
  .addParam('to', 'to address')
  .addParam('value', 'transfer value')
  .setAction(async (taskArgs, { web3 }) => {
    await web3.eth.sendTransaction({
      from: taskArgs.from,
      to: taskArgs.to,
      value: taskArgs.value
    });
    console.log('Transfer succeed');
  });

task('init', 'Initialize config').setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
  const { deployer } = await getNamedAccounts();
  const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts });
  const config = await createWeb3Contract({ name: 'Config_test', deployments, web3, artifacts, from: deployer });
  await config.methods.setStakeManager(stakeManager.options.address).send();
  await config.methods.setSystemCaller(deployer).send();
  console.log('Initialize config finished');
});

task('getsmaddr', 'Get stake manager address')
  .addOptionalParam('address', 'config contract address')
  .setAction(async (taskArgs, { deployments, web3, artifacts }) => {
    const config = await createWeb3Contract({ name: 'Config_test', deployments, web3, artifacts, address: taskArgs.address });
    console.log('Stake manager address:', await config.methods.stakeManager().call());
  });

task('stake', 'Stake to validator')
  .addParam('validator', 'validator address')
  .addOptionalParam('value', 'stake value')
  .addOptionalParam('address', 'stake manager contract address')
  .addFlag('ether', 'use ether as unit')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    if (taskArgs.value === undefined) {
      const estimator = await createEstimatorContract({ stakeManager, deployments, web3, artifacts, from: deployer });
      taskArgs.value = await estimator.methods.estimateMinStakeAmount(taskArgs.validator).call();
    } else if (taskArgs.ether) {
      taskArgs.value = toBN(taskArgs.value)
        .mul(new BN(10).pow(new BN(18)))
        .toString();
    }
    await stakeManager.methods.stake(taskArgs.validator, deployer).send({ value: taskArgs.value, gas: 12475531 });
    console.log('Stake succeed, value:', taskArgs.value);
  });

task('approve', 'Approve share')
  .addParam('validator', 'validator address')
  .addOptionalParam('spender', 'approve spender')
  .addOptionalParam('amount', 'approve amount')
  .addOptionalParam('address', 'stake manager contract address')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    const shareAddress = (await stakeManager.methods.validators(taskArgs.validator).call()).commissionShare;
    if (shareAddress === '0x0000000000000000000000000000000000000000') {
      console.log("validator doesn't exsit!");
      return;
    }
    const commissionShare = await createWeb3Contract({ name: 'CommissionShare', address: shareAddress, deployments, web3, artifacts, from: deployer });
    if (taskArgs.amount === undefined) {
      taskArgs.amount = MAX_INTEGER.toString();
    }
    await commissionShare.methods.approve(taskArgs.spender ?? stakeManager.options.address, taskArgs.amount).send();
    console.log('Approve succeed, amount:', taskArgs.amount);
  });

task('balance', 'Get balance')
  .addParam('address', 'address')
  .addOptionalParam('validator', 'validator address')
  .addOptionalParam('contract', 'ERC20 contract address')
  .addOptionalParam('sAddress', 'stake manager contract address')
  .setAction(async (taskArgs, { deployments, web3, artifacts }) => {
    if (taskArgs.contract === undefined) {
      console.log('GXC balance:', await (web3 as Web3).eth.getBalance(taskArgs.address));
    } else if (taskArgs.validator === undefined) {
      const share = await createWeb3Contract({ name: 'CommissionShare', deployments, web3, artifacts, address: taskArgs.contract });
      console.log(await share.methods.name().call(), 'balance:', await share.methods.balanceOf(taskArgs.address).call());
    } else {
      const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, address: taskArgs.sAddress });
      const shareAddress = (await stakeManager.methods.validators(taskArgs.validator).call()).commissionShare;
      if (shareAddress === '0x0000000000000000000000000000000000000000') {
        console.log("validator doesn't exsit!");
        return;
      }
      const commissionShare = await createWeb3Contract({ name: 'CommissionShare', address: shareAddress, deployments, web3, artifacts });
      console.log(await commissionShare.methods.name().call(), 'balance:', await commissionShare.methods.balanceOf(taskArgs.address).call());
    }
  });

task('sunstake', 'Start unstake')
  .addParam('validator', 'validator address')
  .addOptionalParam('receiver', 'receiver shares')
  .addOptionalParam('shares', 'unstake shares')
  .addFlag('ether', 'use ether as unit')
  .addOptionalParam('repeat', 'repeat times')
  .addOptionalParam('address', 'stake manager contract address')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    if (taskArgs.shares === undefined) {
      const estimator = await createEstimatorContract({ stakeManager, deployments, web3, artifacts, from: deployer });
      taskArgs.shares = await estimator.methods.estimateMinUnstakeShares(taskArgs.validator).call();
      if (taskArgs.shares === '0') {
        console.log("validator doesn't exsit!");
        return;
      }
    } else if (taskArgs.ether) {
      taskArgs.shares = toBN(taskArgs.shares)
        .mul(new BN(10).pow(new BN(18)))
        .toString();
    }
    const repeat = taskArgs.repeat ?? 1;
    for (let i = 0; i < repeat; i++) {
      const { events } = await stakeManager.methods.startUnstake(taskArgs.validator, taskArgs.receiver ?? deployer, taskArgs.shares).send();
      let id;
      if (events) {
        for (const key in events) {
          if (key === 'StartUnstake') {
            id = toBN(events[key].raw.topics[1]).toNumber();
          }
        }
      }
      console.log('Unstake succeed, shares:', taskArgs.shares, 'id:', id);
    }
  });

task('unstake', 'Do unstake')
  .addParam('id', 'unstake id')
  .addOptionalParam('address', 'stake manager contract address')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    await stakeManager.methods.unstake(taskArgs.id).send();
  });

task('vu', 'Visit unstake info by id')
  .addParam('id', 'unstake id')
  .addOptionalParam('address', 'stake manager contract address')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    const u = await stakeManager.methods.unstakeQueue(taskArgs.id).call();
    console.log('\nvalidator:', u.validator, '\nto:', u.to, '\nunstakeShares:', u.unstakeShares, '\ntimestamp:', u.timestamp);
  });

task('vva', 'Visit validator information by address')
  .addParam('validator', 'validator address')
  .addOptionalParam('address', 'stake manager contract address')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    console.log(await stakeManager.methods.validators(taskArgs.validator).call());
  });

task('vvi', 'Visit validator information by index')
  .addParam('index', 'validator index')
  .addOptionalParam('address', 'stake manager contract address')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    const address = await stakeManager.methods.indexedValidatorsByIndex(taskArgs.index).call();
    console.log(await stakeManager.methods.validators(address).call());
  });

task('vp', 'Get validator voting power by address')
  .addParam('validator', 'validator address')
  .addOptionalParam('address', 'stake manager contract address')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    console.log(await stakeManager.methods.getVotingPowerByAddress(taskArgs.validator).call());
  });

task('reward', 'Reward validator(impl through `afterBlock`)')
  .addParam('validator', 'validator address')
  .addParam('value', 'reward amount')
  .addFlag('ether', 'use ether as unit')
  .addOptionalParam('address', 'stake manager contract address')
  .setAction(async (taskArgs, { deployments, web3, getNamedAccounts, artifacts }) => {
    const { deployer } = await getNamedAccounts();
    const stakeManager = await createWeb3Contract({ name: 'StakeManager', deployments, web3, artifacts, from: deployer, address: taskArgs.address });
    if (taskArgs.ether) {
      taskArgs.value = toBN(taskArgs.value)
        .mul(new BN(10).pow(new BN(18)))
        .toString();
    }
    await stakeManager.methods.afterBlock(taskArgs.validator, [], []).send({ value: taskArgs.value });
    console.log('Reward succeed');
  });
