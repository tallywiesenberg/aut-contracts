// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.4;

import {IAutID} from "contracts/IAutID.sol";

contract Governance {


    // events

    struct Tally {

        uint256 forProposal;
        uint256 againstProposal;

    }

    struct Proposal {

        uint identifier;
        uint startTime;
        uint endTime;
        uint tallyDate;
        string metadata; 
        mapping(uint=>Tally) talliesPerRole;
        address initiator;
        mapping(address => bool) voted;

    }

    address public deployer;
    address public daoExpander;
    IAutID public controller;

    mapping(uint=>uint8) public weights;

    uint public proposalCount;
    mapping(uint=>Proposal) public proposals;


    constructor(address _daoExpander, address _controller) {

        daoExpander = _daoExpander;
        controller = IAutID(_controller);

        //require that deployer is a member of the DAO
        IAutID.DAOMember memory daoMember = controller.getMembershipData(msg.sender, daoExpander);
        require(daoMember.isActive, "only members of the community can create a Governance module");

        deployer = msg.sender;

        weights[1] = 10;
        weights[2] = 21;
        weights[3] = 69; //sums to 100?

    }

    function createProposal(uint _startTime, uint _endTime, string memory _metadata) external {
        // function permits anyone to create a proposal with a start and end time. the proposal should point to a CID on IPFS

        proposalCount++;

        proposals[proposalCount].identifier = proposalCount;
        proposals[proposalCount].startTime = _startTime;
        proposals[proposalCount].endTime = _endTime;
        proposals[proposalCount].metadata = _metadata;
        proposals[proposalCount].initiator = msg.sender;
        
    }

    function vote(uint _proposal, bool _inFavor) external {

        Proposal storage p = proposals[_proposal];
        require(block.timestamp >= p.startTime, "cannot vote before start time");
        require(block.timestamp <= p.endTime, "cannot vote after end time");
        require(!p.voted[msg.sender], "cannot vote twice");

        // only members of the DAO can vote
        IAutID.DAOMember memory daoMember = controller.getMembershipData(msg.sender, daoExpander);
        require(daoMember.isActive, "only members of the community can vote");

        if (_inFavor) {
            p.talliesPerRole[daoMember.role].forProposal += weights[daoMember.role];
        } else {
            p.talliesPerRole[daoMember.role].againstProposal += weights[daoMember.role];
        }

        p.voted[msg.sender] = true;
    }

    function getProposal(uint _proposal) external view returns (uint startTime, uint endTime, string memory metadata, uint votesFor, uint votesAgainst) {

        for (uint8 i = 1; i <= 3; i++) {
            votesFor += proposals[_proposal].talliesPerRole[1].forProposal;
            votesAgainst += proposals[_proposal].talliesPerRole[1].againstProposal;
        }

        return (proposals[_proposal].startTime, proposals[_proposal].endTime, proposals[_proposal].metadata, votesFor, votesAgainst);
    }

    function getActiveProposalIDs() external view returns (uint[256] memory activeProposals) {

        for (uint i = 0; i < proposalCount; i++) {
            // if current time is before the end time and after the start time, the proposal is active
            if (block.timestamp >= proposals[i].startTime && block.timestamp <= proposals[i].endTime) {
                activeProposals[i] = (proposals[i].identifier); // can't push to an array stored in memory
            }
        }

        return activeProposals;

    }
}
