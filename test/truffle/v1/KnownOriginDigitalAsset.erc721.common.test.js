const assertRevert = require('../../helpers/assertRevert');
const sendTransaction = require('../../helpers/sendTransaction').sendTransaction;
const etherToWei = require('../../helpers/etherToWei');

const {increaseTo, latest, duration, advanceBlock} = require('../../helpers/time');
const bnChai = require('bn-chai');

const _ = require('lodash');

const KnownOriginDigitalAsset = artifacts.require('KnownOriginDigitalAsset');
const ERC721Receiver = artifacts.require('ERC721ReceiverMockV1');

require('chai')
  .use(require('chai-as-promised'))
  .use(bnChai(web3.utils.BN))
  .should();

contract('KnownOriginDigitalAssetV1 erc721 common', function (accounts) {
  const _developmentAccount = accounts[0];
  const _curatorAccount = accounts[1];

  const _buyer = accounts[3];

  const firstTokenId = 0;
  const secondTokenId = 1;

  const unknownTokenId = 99;

  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const RECEIVER_MAGIC_VALUE = '0xf0b9e5ba';

  const _tokenURI = 'abc123';
  const _editionDigital = web3.utils.asciiToHex('ABC0000000000DIG');
  const _editionPhysical = web3.utils.asciiToHex('ABC0000000000PHY');

  const _priceInWei = etherToWei(0.5);
  let _purchaseFromTime;

  before(async () => {
    // Advance to the next block to correctly read time in the solidity "now" function interpreted by testrpc
    await advanceBlock();
  });

  beforeEach(async () => {
    // developers will mine the contract and pass the curator account into it...
    this.token = await KnownOriginDigitalAsset.new(_curatorAccount, {from: _developmentAccount});
    _purchaseFromTime = await latest(); // opens immediately

    await increaseTo(_purchaseFromTime + duration.seconds(1)); // force time to move 1 seconds so normal tests pass

    // set base commission rates
    await this.token.updateCommission(web3.utils.asciiToHex('DIG'), 12, 12, {from: _developmentAccount});
    await this.token.updateCommission(web3.utils.asciiToHex('PHY'), 24, 15, {from: _developmentAccount});
  });

  describe('like a ERC721BasicToken', () => {
    beforeEach(async () => {
      await this.token.mint(_tokenURI, _editionDigital, _priceInWei, _purchaseFromTime, _curatorAccount, {from: _developmentAccount});
      await this.token.mint(_tokenURI, _editionPhysical, _priceInWei, _purchaseFromTime, _curatorAccount, {from: _developmentAccount});
    });

    describe('balanceOf', () => {
      describe('when the given address owns some tokens', () => {
        it('returns the amount of tokens owned by the given address', async () => {
          const balance = await this.token.balanceOf(_developmentAccount);
          balance.should.be.eq.BN(2);
        });
      });

      describe('when the given address does not own any tokens', () => {
        it('returns 0', async () => {
          const balance = await this.token.balanceOf(_buyer);
          balance.should.be.eq.BN(0);
        });
      });

      describe('when querying the zero address', () => {
        it('throws', async () => {
          await assertRevert(this.token.balanceOf(ZERO_ADDRESS));
        });
      });
    });

    describe('exists', () => {
      describe('when the token exists', () => {
        const tokenId = firstTokenId;

        it('should return true', async () => {
          const result = await this.token.exists(tokenId);
          result.should.be.true;
        });
      });

      describe('when the token does not exist', () => {
        const tokenId = unknownTokenId;

        it('should return false', async () => {
          const result = await this.token.exists(tokenId);
          result.should.be.false;
        });
      });
    });

    describe('ownerOf', () => {
      describe('when the given token ID was tracked by this token', () => {
        const tokenId = firstTokenId;

        it('returns the owner of the given token ID', async () => {
          const owner = await this.token.ownerOf(tokenId);
          owner.should.be.equal(_developmentAccount);
        });
      });

      describe('when the given token ID was not tracked by this token', () => {
        const tokenId = unknownTokenId;

        it('reverts', async () => {
          await assertRevert(this.token.ownerOf(tokenId));
        });
      });
    });

    describe('transfers', () => {
      const owner = _developmentAccount;
      const approved = accounts[2];
      const operator = accounts[3];
      const unauthorized = accounts[4];
      const tokenId = firstTokenId;
      const data = '0x42';

      let logs = null;

      beforeEach(async () => {
        this.to = accounts[1];
        await this.token.approve(approved, tokenId, {from: owner});
        await this.token.setApprovalForAll(operator, true, {from: owner});
      });

      const transferWasSuccessful = function ({owner, tokenId, approved}) {
        it('transfers the ownership of the given token ID to the given address', async () => {
          const newOwner = await this.token.ownerOf(tokenId);
          newOwner.should.be.equal(this.to);
        });

        it('clears the approval for the token ID', async () => {
          const approvedAccount = await this.token.getApproved(tokenId);
          approvedAccount.should.be.equal(ZERO_ADDRESS);
        });

        if (approved) {
          it('emits an approval and transfer events', async () => {
            logs.length.should.be.equal(2);
            logs[0].event.should.be.equal('Approval');
            logs[0].args._owner.should.be.equal(owner);
            logs[0].args._approved.should.be.equal(ZERO_ADDRESS);
            logs[0].args._tokenId.should.be.eq.BN(tokenId);

            logs[1].event.should.be.equal('Transfer');
            logs[1].args._from.should.be.equal(owner);
            logs[1].args._to.should.be.equal(this.to);
            logs[1].args._tokenId.should.be.eq.BN(tokenId);
          });
        } else {
          it('emits only a transfer event', async () => {
            logs.length.should.be.equal(1);
            logs[0].event.should.be.equal('Transfer');
            logs[0].args._from.should.be.equal(owner);
            logs[0].args._to.should.be.equal(this.to);
            logs[0].args._tokenId.should.be.eq.BN(tokenId);
          });
        }

        it('adjusts owners balances', async () => {
          const newOwnerBalance = await this.token.balanceOf(this.to);
          newOwnerBalance.should.be.eq.BN(1);

          const previousOwnerBalance = await this.token.balanceOf(owner);
          previousOwnerBalance.should.be.eq.BN(1);
        });

        it('adjusts owners tokens by index', async () => {
          if (!this.token.tokenOfOwnerByIndex) return;

          const newOwnerToken = await this.token.tokenOfOwnerByIndex(this.to, 0);
          newOwnerToken.toNumber().should.be.equal(tokenId);

          const previousOwnerToken = await this.token.tokenOfOwnerByIndex(owner, 0);
          previousOwnerToken.toNumber().should.not.be.equal(tokenId);
        });
      };

      const shouldTransferTokensByUsers = function (transferFunction) {
        describe('when called by the owner', () => {
          beforeEach(async () => {
            ({logs} = await transferFunction.call(this, owner, this.to, tokenId, {from: owner}));
          });
          transferWasSuccessful({owner, tokenId, approved});
        });

        describe('when called by the approved individual', () => {
          beforeEach(async () => {
            ({logs} = await transferFunction.call(this, owner, this.to, tokenId, {from: approved}));
          });
          transferWasSuccessful({owner, tokenId, approved});
        });

        describe('when called by the operator', () => {
          beforeEach(async () => {
            ({logs} = await transferFunction.call(this, owner, this.to, tokenId, {from: operator}));
          });
          transferWasSuccessful({owner, tokenId, approved});
        });

        describe('when called by the owner without an approved user', () => {
          beforeEach(async () => {
            await this.token.approve(ZERO_ADDRESS, tokenId, {from: owner});
            ({logs} = await transferFunction.call(this, owner, this.to, tokenId, {from: operator}));
          });
          transferWasSuccessful({owner, tokenId, approved: null});
        });

        describe('when sent to the owner', () => {
          beforeEach(async () => {
            ({logs} = await transferFunction.call(this, owner, owner, tokenId, {from: owner}));
          });

          it('keeps ownership of the token', async () => {
            const newOwner = await this.token.ownerOf(tokenId);
            newOwner.should.be.equal(owner);
          });

          it('clears the approval for the token ID', async () => {
            const approvedAccount = await this.token.getApproved(tokenId);
            approvedAccount.should.be.equal(ZERO_ADDRESS);
          });

          it('emits an approval and transfer events', async () => {
            logs.length.should.be.equal(2);
            logs[0].event.should.be.equal('Approval');
            logs[0].args._owner.should.be.equal(owner);
            logs[0].args._approved.should.be.equal(ZERO_ADDRESS);
            logs[0].args._tokenId.should.be.eq.BN(tokenId);

            logs[1].event.should.be.equal('Transfer');
            logs[1].args._from.should.be.equal(owner);
            logs[1].args._to.should.be.equal(owner);
            logs[1].args._tokenId.should.be.eq.BN(tokenId);
          });

          it('keeps the owner balance', async () => {
            const ownerBalance = await this.token.balanceOf(owner);
            ownerBalance.should.be.eq.BN(2);
          });

          it('keeps same tokens by index', async () => {
            if (!this.token.tokenOfOwnerByIndex) return;
            const tokensListed = await Promise.all(_.range(2).map(i => this.token.tokenOfOwnerByIndex(owner, i)));
            tokensListed.map(t => t.toNumber()).should.have.members([firstTokenId, secondTokenId]);
          });
        });

        describe('when the address of the previous owner is incorrect', () => {
          it('reverts', async () => {
            await assertRevert(transferFunction.call(this, unauthorized, this.to, tokenId, {from: owner}));
          });
        });

        describe('when the sender is not authorized for the token id', () => {
          it('reverts', async () => {
            await assertRevert(transferFunction.call(this, owner, this.to, tokenId, {from: unauthorized}));
          });
        });

        describe('when the given token ID does not exist', () => {
          it('reverts', async () => {
            await assertRevert(transferFunction.call(this, owner, this.to, unknownTokenId, {from: owner}));
          });
        });

        describe('when the address to transfer the token to is the zero address', () => {
          it('reverts', async () => {
            await assertRevert(transferFunction.call(this, owner, ZERO_ADDRESS, tokenId, {from: owner}));
          });
        });
      };

      describe('via transferFrom', () => {
        shouldTransferTokensByUsers(function (from, to, tokenId, opts) {
          return this.token.transferFrom(from, to, tokenId, opts);
        });
      });

      describe('via safeTransferFrom', () => {
        const safeTransferFromWithData = function (from, to, tokenId, opts) {
          return sendTransaction(
            this.token,
            'safeTransferFrom',
            'address,address,uint256,bytes',
            [from, to, tokenId, data],
            opts
          );
        };

        const safeTransferFromWithoutData = function (from, to, tokenId, opts) {
          return this.token.safeTransferFrom(from, to, tokenId, opts);
        };

        const shouldTransferSafely = function (transferFun, data) {
          describe('to a user account', () => {
            shouldTransferTokensByUsers(transferFun);
          });

          describe('to a valid receiver contract', () => {
            beforeEach(async () => {
              this.receiver = await ERC721Receiver.new(RECEIVER_MAGIC_VALUE, false);
              this.to = this.receiver.address;
            });

            shouldTransferTokensByUsers(transferFun);

            // TODO find solution to decodeLogs
            it.skip('should call onERC721Received', async () => {

              // Moved from decodeLogs.js
              const SolidityEvent = require('web3/lib/web3/event.js');

              function decodeLogs(logs, contract, address) {
                return logs.map(log => {
                  const event = new SolidityEvent(null, contract.events[log.topics[0]], address);
                  return event.decode(log);
                });
              }

              const result = await transferFun.call(this, owner, this.to, tokenId, {from: owner});
              result.receipt.logs.length.should.be.equal(3);
              const [log] = decodeLogs([result.receipt.logs[2]], ERC721Receiver, this.receiver.address);
              log.event.should.be.equal('Received');
              log.args._address.should.be.equal(owner);
              log.args._tokenId.toNumber().should.be.equal(tokenId);
              log.args._data.should.be.equal(data);
            });
          });
        };

        // TODO does truffle 5 change method overloading?
        describe.skip('with data', () => {
          shouldTransferSafely(safeTransferFromWithData, data);
        });

        describe('without data', () => {
          shouldTransferSafely(safeTransferFromWithoutData, '0x');
        });

        describe('to a receiver contract returning unexpected value', () => {
          it('reverts', async () => {
            const invalidReceiver = await ERC721Receiver.new('0x42', false);
            await assertRevert(this.token.safeTransferFrom(owner, invalidReceiver.address, tokenId, {from: owner}));
          });
        });

        describe('to a receiver contract that throws', () => {
          it('reverts', async () => {
            const invalidReceiver = await ERC721Receiver.new(RECEIVER_MAGIC_VALUE, true);
            await assertRevert(this.token.safeTransferFrom(owner, invalidReceiver.address, tokenId, {from: owner}));
          });
        });

        describe('to a contract that does not implement the required function', () => {
          it('reverts', async () => {
            const invalidReceiver = this.token;
            await assertRevert(this.token.safeTransferFrom(owner, invalidReceiver.address, tokenId, {from: owner}));
          });
        });
      });
    });

    describe('approve', () => {
      const tokenId = firstTokenId;
      const sender = _developmentAccount;
      const to = accounts[1];

      let logs = null;

      const itClearsApproval = () => {
        it('clears approval for the token', async () => {
          const approvedAccount = await this.token.getApproved(tokenId);
          approvedAccount.should.be.equal(ZERO_ADDRESS);
        });
      };

      const itApproves = function (address) {
        it('sets the approval for the target address', async () => {
          const approvedAccount = await this.token.getApproved(tokenId);
          approvedAccount.should.be.equal(address);
        });
      };

      const itEmitsApprovalEvent = function (address) {
        it('emits an approval event', async () => {
          logs.length.should.be.equal(1);
          logs[0].event.should.be.equal('Approval');
          logs[0].args._owner.should.be.equal(sender);
          logs[0].args._approved.should.be.equal(address);
          logs[0].args._tokenId.should.be.eq.BN(tokenId);
        });
      };

      describe('when clearing approval', () => {
        describe('when there was no prior approval', () => {
          beforeEach(async () => {
            ({logs} = await this.token.approve(ZERO_ADDRESS, tokenId, {from: sender}));
          });

          itClearsApproval();

          it('does not emit an approval event', async () => {
            logs.length.should.be.equal(0);
          });
        });

        describe('when there was a prior approval', () => {
          beforeEach(async () => {
            await this.token.approve(to, tokenId, {from: sender});
            ({logs} = await this.token.approve(ZERO_ADDRESS, tokenId, {from: sender}));
          });

          itClearsApproval();
          itEmitsApprovalEvent(ZERO_ADDRESS);
        });
      });

      describe('when approving a non-zero address', () => {
        describe('when there was no prior approval', () => {
          beforeEach(async () => {
            ({logs} = await this.token.approve(to, tokenId, {from: sender}));
          });

          itApproves(to);
          itEmitsApprovalEvent(to);
        });

        describe('when there was a prior approval to the same address', () => {
          beforeEach(async () => {
            await this.token.approve(to, tokenId, {from: sender});
            ({logs} = await this.token.approve(to, tokenId, {from: sender}));
          });

          itApproves(to);
          itEmitsApprovalEvent(to);
        });

        describe('when there was a prior approval to a different address', () => {
          beforeEach(async () => {
            await this.token.approve(accounts[2], tokenId, {from: sender});
            ({logs} = await this.token.approve(to, tokenId, {from: sender}));
          });

          itApproves(to);
          itEmitsApprovalEvent(to);
        });
      });

      describe('when the address that receives the approval is the owner', () => {
        it('reverts', async () => {
          await assertRevert(this.token.approve(sender, tokenId, {from: sender}));
        });
      });

      describe('when the sender does not own the given token ID', () => {
        it('reverts', async () => {
          await assertRevert(this.token.approve(to, tokenId, {from: accounts[2]}));
        });
      });

      describe('when the sender is approved for the given token ID', () => {
        it('reverts', async () => {
          await this.token.approve(accounts[2], tokenId, {from: sender});
          await assertRevert(this.token.approve(to, tokenId, {from: accounts[2]}));
        });
      });

      describe('when the sender is an operator', () => {
        const operator = accounts[2];
        beforeEach(async () => {
          await this.token.setApprovalForAll(operator, true, {from: sender});
          ({logs} = await this.token.approve(to, tokenId, {from: operator}));
        });

        itApproves(to);
        itEmitsApprovalEvent(to);
      });

      describe('when the given token ID does not exist', () => {
        it('reverts', async () => {
          await assertRevert(this.token.approve(to, unknownTokenId, {from: sender}));
        });
      });
    });

    describe('setApprovalForAll', () => {
      const sender = _developmentAccount;

      describe('when the operator willing to approve is not the owner', () => {
        const operator = accounts[1];

        describe('when there is no operator approval set by the sender', () => {
          it('approves the operator', async () => {
            await this.token.setApprovalForAll(operator, true, {from: sender});

            const isApproved = await this.token.isApprovedForAll(sender, operator);
            isApproved.should.be.true;
          });

          it('emits an approval event', async () => {
            const {logs} = await this.token.setApprovalForAll(operator, true, {from: sender});

            logs.length.should.be.equal(1);
            logs[0].event.should.be.equal('ApprovalForAll');
            logs[0].args._owner.should.be.equal(sender);
            logs[0].args._operator.should.be.equal(operator);
            logs[0].args._approved.should.be.true;
          });
        });

        describe('when the operator was set as not approved', () => {
          beforeEach(async () => {
            await this.token.setApprovalForAll(operator, false, {from: sender});
          });

          it('approves the operator', async () => {
            await this.token.setApprovalForAll(operator, true, {from: sender});

            const isApproved = await this.token.isApprovedForAll(sender, operator);
            isApproved.should.be.true;
          });

          it('emits an approval event', async () => {
            const {logs} = await this.token.setApprovalForAll(operator, true, {from: sender});

            logs.length.should.be.equal(1);
            logs[0].event.should.be.equal('ApprovalForAll');
            logs[0].args._owner.should.be.equal(sender);
            logs[0].args._operator.should.be.equal(operator);
            logs[0].args._approved.should.be.true;
          });

          it('can unset the operator approval', async () => {
            await this.token.setApprovalForAll(operator, false, {from: sender});

            const isApproved = await this.token.isApprovedForAll(sender, operator);
            isApproved.should.be.false;
          });
        });

        describe('when the operator was already approved', () => {
          beforeEach(async () => {
            await this.token.setApprovalForAll(operator, true, {from: sender});
          });

          it('keeps the approval to the given address', async () => {
            await this.token.setApprovalForAll(operator, true, {from: sender});

            const isApproved = await this.token.isApprovedForAll(sender, operator);
            isApproved.should.be.true;
          });

          it('emits an approval event', async () => {
            const {logs} = await this.token.setApprovalForAll(operator, true, {from: sender});

            logs.length.should.be.equal(1);
            logs[0].event.should.be.equal('ApprovalForAll');
            logs[0].args._owner.should.be.equal(sender);
            logs[0].args._operator.should.be.equal(operator);
            logs[0].args._approved.should.be.true;
          });
        });
      });

      describe('when the operator is the owner', () => {
        const operator = _developmentAccount;

        it('reverts', async () => {
          await assertRevert(this.token.setApprovalForAll(operator, true, {from: sender}));
        });
      });
    });
  });

  describe('like a mintable and burnable ERC721Token', () => {

    beforeEach(async () => {
      await this.token.mint(_tokenURI, _editionDigital, _priceInWei, _purchaseFromTime, _curatorAccount, {
        from: _developmentAccount
      });
      await this.token.mint(_tokenURI, _editionPhysical, _priceInWei, _purchaseFromTime, _curatorAccount, {
        from: _developmentAccount
      });
    });

    describe('mint', () => {
      let logs = null;

      describe('when successful', () => {
        beforeEach(async () => {
          const result = await this.token.mint(_tokenURI, web3.utils.asciiToHex('XYZ0000000000DIG'), _priceInWei, _purchaseFromTime, _curatorAccount, {
            from: _developmentAccount
          });
          logs = result.logs;
        });

        it('assigns the token to the new owner', async () => {
          const owner = await this.token.ownerOf(2); // zero indexed
          owner.should.be.equal(_developmentAccount);
        });

        it('increases the balance of its owner', async () => {
          const balance = await this.token.balanceOf(_developmentAccount);
          balance.should.be.eq.BN(3);
        });

        it('emits a transfer event', async () => {
          logs.length.should.be.equal(1);
          logs[0].event.should.be.equal('Transfer');
          logs[0].args._from.should.be.equal(ZERO_ADDRESS);
          logs[0].args._to.should.be.equal(_developmentAccount);
          logs[0].args._tokenId.should.be.eq.BN(2);
        });
      });
    });

    describe('burn', () => {
      const tokenId = firstTokenId;
      const sender = _developmentAccount;
      let logs = null;

      describe('when successful', () => {
        beforeEach(async () => {
          const result = await this.token.burn(tokenId, {from: sender});
          logs = result.logs;
        });

        it('burns the given token ID and adjusts the balance of the owner', async () => {
          await assertRevert(this.token.ownerOf(tokenId));
          const balance = await this.token.balanceOf(sender);
          balance.should.be.eq.BN(1);
        });

        it('emits a burn event', async () => {
          logs.length.should.be.equal(1);
          logs[0].event.should.be.equal('Transfer');
          logs[0].args._from.should.be.equal(sender);
          logs[0].args._to.should.be.equal(ZERO_ADDRESS);
          logs[0].args._tokenId.should.be.eq.BN(tokenId);
        });
      });

      describe('when there is a previous approval', () => {
        beforeEach(async () => {
          await this.token.approve(_buyer, tokenId, {from: sender});
          const result = await this.token.burn(tokenId, {from: sender});
          logs = result.logs;
        });

        it('clears the approval', async () => {
          const approvedAccount = await this.token.getApproved(tokenId);
          approvedAccount.should.be.equal(ZERO_ADDRESS);
        });

        it('emits an approval event', async () => {
          logs.length.should.be.equal(2);

          logs[0].event.should.be.equal('Approval');
          logs[0].args._owner.should.be.equal(sender);
          logs[0].args._approved.should.be.equal(ZERO_ADDRESS);
          logs[0].args._tokenId.should.be.eq.BN(tokenId);

          logs[1].event.should.be.equal('Transfer');
        });
      });

      describe('when the given token ID was not tracked by this contract', () => {
        it('reverts', async () => {
          await assertRevert(this.token.burn(unknownTokenId, {from: _developmentAccount}));
        });
      });
    });
  });

});
