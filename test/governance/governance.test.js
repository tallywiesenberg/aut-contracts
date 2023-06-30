const { expect } = require("chai");
const { ethers } = require("hardhat");
const {setBalance} = require("@nomicfoundation/hardhat-network-helpers");

let daoMember, voter, randomGuy, addrs
let autIdAddress, daoExpanderFactoryAddress, daoExpanderAddress
let governance
let autId, daoExpanderFactory, daoTypes, pluginRegistry
let mockMolochDAO

describe("Governance", () => {

    async function fundAccountWithEther(account) {
        const desiredFundingAmount = ethers.utils.parseEther("10");

        // Fund the accounts with Goerli Ether
        await setBalance(account.address, desiredFundingAmount);
    }

    before(async function () {
        [daoMember, voter, randomGuy, ...addrs] = await ethers.getSigners();

        await fundAccountWithEther(daoMember)
        await fundAccountWithEther(voter)
        await fundAccountWithEther(randomGuy)

    })

    beforeEach(async function () {

        // https://docs.aut.id/v2/protocols-and-contracts/deployed-contracts
        autIdAddress = "0x56C5E4126B2D2E4b3d4319639d0272420f1FEd4A"
        daoExpanderFactoryAddress = "0x01E228655660d9e1370400cC067108caf4BdE9F5"

        autId = await ethers.getContractAt("AutID", autIdAddress)
        daoExpanderFactory = await ethers.getContractAt("DAOExpanderFactory", daoExpanderFactoryAddress)

        // deploy mock DAO
        const MockMolochDAO = await ethers.getContractFactory("Moloch")
        mockMolochDAO = await MockMolochDAO.deploy()
        await mockMolochDAO.deployed()

        // deply DAO types
        const DAOTypes = await ethers.getContractFactory("DAOTypes");
        daoTypes = await DAOTypes.deploy();
        await daoTypes.deployed();

        // deploy module registry
        const ModuleRegistryFactory = await ethers.getContractFactory("ModuleRegistry");
        const moduleRegistry = await ModuleRegistryFactory.deploy();

        // deploy plugin registry
        const PluginRegistryFactory = await ethers.getContractFactory("PluginRegistry");
        pluginRegistry = await PluginRegistryFactory.deploy(moduleRegistry.address);
        await pluginRegistry.deployed()

        // deploy DAO expander
        daoExpanderAddress = await daoExpanderFactory.connect(daoMember).deployDAOExpander(
            daoMember.address,
            autIdAddress,
            daoTypes.address,
            1,
            mockMolochDAO.address,
            1,
            "https://someurl.com",
            10,
            pluginRegistry.address
        )


        // add deployer and voter as DAO member
        await mockMolochDAO.addMember(daoMember.address)
        await mockMolochDAO.addMember(voter.address)


        // access governance module
        const Governance = await ethers.getContractFactory("Governance");

        // deploying governance module with non-DAO-member reverts
        await expect(
            Governance.connect(randomGuy).deploy(daoExpanderAddress, autIdAddress)
        ).to.be.revertedWith("only members of the community can create a Governance module")
        
        // deploy governance module with the DAO member
        governance = await Governance.connect(daoMember).deploy(daoExpanderAddress, autIdAddress);
        await governance.deployed()
        expect(governance.address).not.eq(ethers.constants.AddressZero);
        expect(governance.address).not.to.be.undefined;

    })

    it("createProposal", async function () {

        // confirm there is no proposal at proposalCount 1
        let p1 = await governance.getProposal(1)

        expect(p1.startTime).equals(0, "before a first proposal is created, startTime should be 0")
        expect(p1.endTime).equals(0, "before a first proposal is created, endTime should be 0")
        expect(p1.metadata).equals("", "before a first proposal is created, metadata should be empty")
        expect(p1.votesFor).equals(0, "before a first proposal is created, votesFor should be 0")
        expect(p1.votesAgainst).equals(0, "before a first proposal is created, votesAgainst should be 0")


        // confirm there are no active proposals
        let activeIds = await getActiveProposalIDs.getActiveProposalIDs()

        expect(activeIds, "before a first proposal is created, there should not be any active IDs").to.be.empty

        // create a proposal starting now lasting 1 week
        let now = Math.floor(Date.now() / 1000)
        let oneWeek = 60*60*24*7
        let metadata = "ipfs://exampleMetadata"
        await governance.createProposal(now, now + oneWeek, metadata)

        // confirm there is a proposalCount 1
        p1 = await governance.getProposal(1)

        expect(p1.startTime).equals(now, "when the proposal was created, startTime did not set")
        expect(p1.endTime).equals(now + oneWeek, "when the proposal was created, endTime did not set")
        expect(p1.metadata).equals(metadata, "when the proposal was created, metadata was not set")
        expect(p1.votesFor).equals(0, "when the proposal was created, votesFor should be 0")
        expect(p1.votesAgainst).equals(0, "when the proposal was created, votesAgainst should be 0")

        // confirm the active proposal ids are [1]
        activeIds = await governance.getActiveProposalIDs()
        expect(activeIds).equals([1], "after the first proposal is created, there should be just one active ID")

    })

    it("vote", async function () {

        // create a proposal starting in 1 day lasting 1 week
        let oneDay = 60*60*24
        let start = Math.floor(Date.now() / 1000) + oneDay
        let end = start + oneDay*7
        let metadata = "ipfs://exampleMetadata"

        await governance.createProposal(start, end, metadata)

        let proposalCount = await governance.proposalCount()

        // revert: try to vote before the start period
        await expect(
            governance.connect(voter).vote(proposalCount, true)
        ).to.be.revertedWith("cannot vote before start time")

        // fast forward 2 days, dao member votes
        await ethers.provider.send("evm_setNextBlockTimestamp", [start + oneDay*2]);
        await ethers.provider.send("evm_mine");
        await governance.connect(voter).vote(proposalCount, true)

        // revert: dao member tries to vote twice
        await expect(
            governance.connect(voter).vote(proposalCount, true)
        ).to.be.revertedWith("cannot vote twice")

        // revert: only DAO members can vote
        await expect(
            governance.connect(randomGuy).vote(proposalCount, true)
        ).to.be.revertedWith("only members of the community can vote")

        // revert: try to vote after the end period
        await ethers.provider.send("evm_setNextBlockTimestamp", [start + oneDay*6]);
        await ethers.provider.send("evm_mine");

        await expect(
            governance.connect(voter).vote(proposalCount, true)
        ).to.be.revertedWith("cannot vote after end time")
    })

    it("getProposal", async function () {

        // create two new proposals
        let oneDay = 60*60*24
        let start = Math.floor(Date.now() / 1000) + oneDay
        let end = start + oneDay*7
        let metadata = "ipfs://exampleMetadata"

        await governance.createProposal(start, end, metadata)
        await governance.createProposal(start, end, metadata)

        // access the proposals
        let p1 = await governance.getProposal(1)
        let p2 = await getProposal.getProposal(2)

        // double check the properties of the proposals
        expect(p1.startTime).equals(now, "when the proposal was created, startTime did not set")
        expect(p1.endTime).equals(now + oneWeek, "when the proposal was created, endTime did not set")
        expect(p1.metadata).equals(metadata, "when the proposal was created, metadata was not set")
        expect(p1.votesFor).equals(0, "when the proposal was created, votesFor changed")
        expect(p1.votesAgainst).equals(0, "when the proposal was created, votesAgainst")

        expect(p2.startTime).equals(now, "when the proposal was created, startTime did not set")
        expect(p2.endTime).equals(now + oneWeek, "when the proposal was created, endTime did not set")
        expect(p2.metadata).equals(metadata, "when the proposal was created, metadata was not set")
        expect(p2.votesFor).equals(0, "when the proposal was created, votesFor should be 0")
        expect(p2.votesAgainst).equals(0, "when the proposal was created, votesAgainst should be 0")


    })

    it("getActiveProposalIDs", async function () {

        // create a proposal
        let oneDay = 60*60*24
        let start = Math.floor(Date.now() / 1000) + oneDay
        let end = start + oneDay*7
        let metadata = "ipfs://exampleMetadata"

        await governance.createProposal(start, end, metadata)

        // there should now be one active proposal in the returned array
        let activeIds = await governance.getActiveProposalIDs()
        expect(activeIds, "active proposal 1 should have been added to the active IDs").to.not.be.empty
        expect(activeIds).equals([1], "the active IDs should be [1]")


        // create another proposal
        await governance.createProposal(start, end, metadata)

        // there should now be two active proposals in the returned array
        activeIds = await governance.getActiveProposalIDs()
        expect(activeIds, "active proposals 1 and 2 should have been added to the active IDs").to.not.be.empty
        expect(activeIds).equals([1, 2], "the active IDs should be [1, 2]")


    })

})