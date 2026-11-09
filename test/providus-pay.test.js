/* eslint-disable @typescript-eslint/no-require-imports */
const { expect } = require("chai");
const { ethers } = require("hardhat");

function intent(tag) {
  return ethers.keccak256(ethers.toUtf8Bytes(tag));
}

async function futureDeadline(offsetSeconds) {
  const block = await ethers.provider.getBlock("latest");
  return block.timestamp + (offsetSeconds || 3600);
}

describe("ProvidusPay (B4A non-custodial immediate forwarding)", function () {
  let owner;
  let payer;
  let payer2;
  let recipient;
  let mock;
  let pay;

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    owner = signers[0];
    payer = signers[1];
    payer2 = signers[2];
    recipient = signers[3];

    const Mock = await ethers.getContractFactory("MockERC20", owner);
    mock = await Mock.deploy("Mock USD", "mUSD");
    await mock.waitForDeployment();

    const Pay = await ethers.getContractFactory("ProvidusPay", owner);
    pay = await Pay.deploy([await mock.getAddress()]);
    await pay.waitForDeployment();

    const mintAmount = ethers.parseUnits("1000", 18);
    await mock.mint(payer.address, mintAmount);
    await mock.mint(payer2.address, mintAmount);
  });

  it("native pay success + event args", async function () {
    const id = intent("native-success-" + Date.now().toString());
    const deadline = await futureDeadline();
    const amount = ethers.parseEther("1");
    const payAddr = await pay.getAddress();

    const beforeRecipient = await ethers.provider.getBalance(recipient.address);
    const tx = await pay
      .connect(payer)
      .payNative(id, recipient.address, deadline, { value: amount });
    await expect(tx)
      .to.emit(pay, "PaymentExecuted")
      .withArgs(id, payer.address, recipient.address, ethers.ZeroAddress, amount);

    const afterRecipient = await ethers.provider.getBalance(recipient.address);
    expect(afterRecipient - beforeRecipient).to.equal(amount);
    expect(await ethers.provider.getBalance(payAddr)).to.equal(0n);
  });

  it("ERC20 pay success + event args", async function () {
    const id = intent("erc20-success");
    const deadline = await futureDeadline();
    const amount = ethers.parseUnits("25", 18);
    const mockAddr = await mock.getAddress();
    const payAddr = await pay.getAddress();

    await mock.connect(payer).approve(payAddr, amount);
    const beforeRecipient = await mock.balanceOf(recipient.address);
    const tx = await pay
      .connect(payer)
      .payToken(id, mockAddr, recipient.address, amount, deadline);
    await expect(tx)
      .to.emit(pay, "PaymentExecuted")
      .withArgs(id, payer.address, recipient.address, mockAddr, amount);

    expect(await mock.balanceOf(recipient.address)).to.equal(
      beforeRecipient + amount
    );
    expect(await mock.balanceOf(payAddr)).to.equal(0n);
  });

  it("payer binding = msg.sender in event (explicit check)", async function () {
    const id = intent("payer-binding");
    const deadline = await futureDeadline();
    const amount = ethers.parseEther("0.1");
    const tx = await pay
      .connect(payer2)
      .payNative(id, recipient.address, deadline, { value: amount });
    await expect(tx)
      .to.emit(pay, "PaymentExecuted")
      .withArgs(id, payer2.address, recipient.address, ethers.ZeroAddress, amount);
  });

  it("zero amount reverts (native)", async function () {
    const id = intent("zero-native");
    const deadline = await futureDeadline();
    await expect(
      pay.connect(payer).payNative(id, recipient.address, deadline, { value: 0 })
    ).to.be.revertedWith("ProvidusPay: zero amount");
  });

  it("zero amount reverts (token)", async function () {
    const id = intent("zero-token");
    const deadline = await futureDeadline();
    const mockAddr = await mock.getAddress();
    await expect(
      pay.connect(payer).payToken(id, mockAddr, recipient.address, 0, deadline)
    ).to.be.revertedWith("ProvidusPay: zero amount");
  });

  it("zero recipient reverts (native)", async function () {
    const id = intent("zero-recipient-native");
    const deadline = await futureDeadline();
    await expect(
      pay.connect(payer).payNative(id, ethers.ZeroAddress, deadline, {
        value: ethers.parseEther("0.1"),
      })
    ).to.be.revertedWith("ProvidusPay: zero recipient");
  });

  it("zero recipient reverts (token)", async function () {
    const id = intent("zero-recipient-token");
    const deadline = await futureDeadline();
    const mockAddr = await mock.getAddress();
    await expect(
      pay
        .connect(payer)
        .payToken(
          id,
          mockAddr,
          ethers.ZeroAddress,
          ethers.parseUnits("1", 18),
          deadline
        )
    ).to.be.revertedWith("ProvidusPay: zero recipient");
  });

  it("expired deadline reverts (native and token)", async function () {
    const expired = 1;
    const mockAddr = await mock.getAddress();
    const payAddr = await pay.getAddress();
    await mock
      .connect(payer)
      .approve(payAddr, ethers.parseUnits("1", 18));
    await expect(
      pay.connect(payer).payNative(intent("exp-n"), recipient.address, expired, {
        value: ethers.parseEther("0.1"),
      })
    ).to.be.revertedWith("ProvidusPay: expired deadline");
    await expect(
      pay
        .connect(payer)
        .payToken(
          intent("exp-t"),
          mockAddr,
          recipient.address,
          ethers.parseUnits("1", 18),
          expired
        )
    ).to.be.revertedWith("ProvidusPay: expired deadline");
  });

  it("unsupported token reverts", async function () {
    const Other = await ethers.getContractFactory("MockERC20", owner);
    const other = await Other.deploy("Other", "OTH");
    await other.waitForDeployment();
    const otherAddr = await other.getAddress();
    await other.mint(payer.address, ethers.parseUnits("10", 18));
    const payAddr = await pay.getAddress();
    await other.connect(payer).approve(payAddr, ethers.parseUnits("10", 18));
    await expect(
      pay
        .connect(payer)
        .payToken(
          intent("unsupported"),
          otherAddr,
          recipient.address,
          ethers.parseUnits("1", 18),
          await futureDeadline()
        )
    ).to.be.revertedWith("ProvidusPay: token not allowed");
  });

  it("reused intentId same payer reverts AND same intentId different payer succeeds", async function () {
    const id = intent("replay-shared");
    const deadline = await futureDeadline();
    const amount = ethers.parseEther("0.2");
    await pay
      .connect(payer)
      .payNative(id, recipient.address, deadline, { value: amount });
    await expect(
      pay.connect(payer).payNative(id, recipient.address, deadline, {
        value: amount,
      })
    ).to.be.revertedWith("ProvidusPay: intent already used");
    // different payer, same intentId succeeds
    await expect(
      pay.connect(payer2).payNative(id, recipient.address, deadline, {
        value: amount,
      })
    ).to.emit(pay, "PaymentExecuted");
  });

  it("reentrancy attempt reverts with no double-spend", async function () {
    const Attacker = await ethers.getContractFactory(
      "MaliciousReceiver",
      owner
    );
    const attacker = await Attacker.deploy({ value: ethers.parseEther("0.01") });
    await attacker.waitForDeployment();
    const attackerAddr = await attacker.getAddress();
    const payAddr = await pay.getAddress();
    const mockAddr = await mock.getAddress();

    // fund attacker with tokens for token re-entry attempt
    await mock.mint(attackerAddr, ethers.parseUnits("100", 18));
    const reentryNative = intent("reentry-native");
    const reentryToken = intent("reentry-token");
    await attacker.armToken(mockAddr, reentryNative, reentryToken);

    const id = intent("attack-initial");
    const deadline = await futureDeadline();
    const payout = ethers.parseEther("1");
    const beforeRecipient = await ethers.provider.getBalance(attackerAddr);

    // attacker calls payNative with itself as recipient -> receive() fires
    await attacker
      .connect(payer)
      .attackNative(payAddr, id, attackerAddr, deadline, {
        value: payout,
      });

    // re-entry flags must be false (both attempts reverted)
    expect(await attacker.nativeReentrySuccess()).to.equal(false);
    expect(await attacker.tokenReentrySuccess()).to.equal(false);

    // no double-spend: attacker got exactly one payout (plus initial funding minus gas is payer-side; check contract holds nothing)
    const afterRecipient = await ethers.provider.getBalance(attackerAddr);
    expect(afterRecipient - beforeRecipient).to.equal(payout);
    expect(await ethers.provider.getBalance(payAddr)).to.equal(0n);
  });

  it("failing token reverts whole tx", async function () {
    const Fail = await ethers.getContractFactory("FailingToken", owner);
    const fail = await Fail.deploy();
    await fail.waitForDeployment();
    const failAddr = await fail.getAddress();
    // owner allowlists failing token so we reach SafeERC20 path
    await pay.connect(owner).setTokenAllowed(failAddr, true);
    await fail.mint(payer.address, ethers.parseUnits("10", 18));
    const payAddr = await pay.getAddress();
    await fail.connect(payer).approve(payAddr, ethers.parseUnits("10", 18));
    const beforeRecipient = await fail.balanceOf(recipient.address);
    await expect(
      pay
        .connect(payer)
        .payToken(
          intent("failing"),
          failAddr,
          recipient.address,
          ethers.parseUnits("1", 18),
          await futureDeadline()
        )
    ).to.be.reverted;
    expect(await fail.balanceOf(recipient.address)).to.equal(beforeRecipient);
    expect(await fail.balanceOf(payAddr)).to.equal(0n);
  });

  it("contract retains no balance after payouts", async function () {
    const payAddr = await pay.getAddress();
    const mockAddr = await mock.getAddress();
    const nId = intent("drain-native");
    const tId = intent("drain-token");
    const deadline = await futureDeadline();
    const nAmount = ethers.parseEther("0.5");
    const tAmount = ethers.parseUnits("5", 18);
    await pay
      .connect(payer)
      .payNative(nId, recipient.address, deadline, { value: nAmount });
    await mock.connect(payer).approve(payAddr, tAmount);
    await pay
      .connect(payer)
      .payToken(tId, mockAddr, recipient.address, tAmount, deadline);
    expect(await ethers.provider.getBalance(payAddr)).to.equal(0n);
    expect(await mock.balanceOf(payAddr)).to.equal(0n);
  });

  it("non-owner cannot change allowlist, owner can", async function () {
    const Other = await ethers.getContractFactory("MockERC20", owner);
    const other = await Other.deploy("Other2", "O2");
    await other.waitForDeployment();
    const otherAddr = await other.getAddress();
    expect(await pay.allowedTokens(otherAddr)).to.equal(false);
    await expect(
      pay.connect(payer).setTokenAllowed(otherAddr, true)
    ).to.be.reverted;
    await expect(pay.connect(owner).setTokenAllowed(otherAddr, true)).to.not.be.reverted;
    expect(await pay.allowedTokens(otherAddr)).to.equal(true);
    await pay.connect(owner).setTokenAllowed(otherAddr, false);
    expect(await pay.allowedTokens(otherAddr)).to.equal(false);
  });
});
