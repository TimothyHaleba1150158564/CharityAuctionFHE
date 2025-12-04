// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract CharityAuctionFHE is SepoliaConfig {
    struct AuctionItem {
        euint32 encryptedItemId;
        string publicDescription;
        uint256 endTime;
        bool isActive;
    }

    struct Bid {
        euint32 encryptedBidAmount;
        euint32 encryptedBidderId;
        uint256 timestamp;
    }

    struct WinningBid {
        uint32 winningAmount;
        address winner;
        bool isRevealed;
    }

    uint256 public auctionCount;
    mapping(uint256 => AuctionItem) public auctions;
    mapping(uint256 => Bid[]) public bids;
    mapping(uint256 => WinningBid) public winningBids;
    
    mapping(uint256 => uint256) private requestToAuctionId;
    
    event AuctionCreated(uint256 indexed auctionId, string description);
    event BidSubmitted(uint256 indexed auctionId);
    event WinnerDeclared(uint256 indexed auctionId, address winner);
    event BidRevealed(uint256 indexed auctionId);

    modifier onlyAuctionOwner(uint256 auctionId) {
        // In production, add proper ownership check
        _;
    }

    modifier onlyActiveAuction(uint256 auctionId) {
        require(auctions[auctionId].isActive, "Auction not active");
        require(block.timestamp < auctions[auctionId].endTime, "Auction ended");
        _;
    }

    function createAuction(
        euint32 encryptedItemId,
        string memory publicDescription,
        uint256 duration
    ) public {
        auctionCount += 1;
        uint256 newAuctionId = auctionCount;
        
        auctions[newAuctionId] = AuctionItem({
            encryptedItemId: encryptedItemId,
            publicDescription: publicDescription,
            endTime: block.timestamp + duration,
            isActive: true
        });
        
        emit AuctionCreated(newAuctionId, publicDescription);
    }

    function placeBid(
        uint256 auctionId,
        euint32 encryptedBidAmount,
        euint32 encryptedBidderId
    ) public onlyActiveAuction(auctionId) {
        bids[auctionId].push(Bid({
            encryptedBidAmount: encryptedBidAmount,
            encryptedBidderId: encryptedBidderId,
            timestamp: block.timestamp
        }));
        
        emit BidSubmitted(auctionId);
    }

    function determineWinner(uint256 auctionId) public onlyAuctionOwner(auctionId) {
        require(block.timestamp >= auctions[auctionId].endTime, "Auction not ended");
        require(bids[auctionId].length > 0, "No bids placed");
        
        bytes32[] memory ciphertexts = new bytes32[](bids[auctionId].length * 2);
        
        for (uint256 i = 0; i < bids[auctionId].length; i++) {
            ciphertexts[i] = FHE.toBytes32(bids[auctionId][i].encryptedBidAmount);
            ciphertexts[i + bids[auctionId].length] = FHE.toBytes32(bids[auctionId][i].encryptedBidderId);
        }
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.findHighestBid.selector);
        requestToAuctionId[reqId] = auctionId;
    }

    function findHighestBid(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 auctionId = requestToAuctionId[requestId];
        require(auctionId != 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32[] memory bidData = abi.decode(cleartexts, (uint32[]));
        uint256 bidCount = bidData.length / 2;
        
        uint32 highestAmount = 0;
        uint32 winningBidderId = 0;
        uint256 winningIndex = 0;
        
        for (uint256 i = 0; i < bidCount; i++) {
            if (bidData[i] > highestAmount) {
                highestAmount = bidData[i];
                winningBidderId = bidData[i + bidCount];
                winningIndex = i;
            }
        }
        
        winningBids[auctionId] = WinningBid({
            winningAmount: highestAmount,
            winner: bids[auctionId][winningIndex].timestamp == 0 ? 
                address(0) : address(uint160(winningBidderId)),
            isRevealed: true
        });
        
        auctions[auctionId].isActive = false;
        emit WinnerDeclared(auctionId, winningBids[auctionId].winner);
    }

    function revealBidDetails(uint256 auctionId, uint256 bidIndex) public {
        require(bidIndex < bids[auctionId].length, "Invalid bid index");
        require(winningBids[auctionId].isRevealed, "Winner not determined");
        
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(bids[auctionId][bidIndex].encryptedBidAmount);
        ciphertexts[1] = FHE.toBytes32(bids[auctionId][bidIndex].encryptedBidderId);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptBid.selector);
        requestToAuctionId[reqId] = auctionId;
    }

    function decryptBid(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 auctionId = requestToAuctionId[requestId];
        require(auctionId != 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32[] memory bidDetails = abi.decode(cleartexts, (uint32[]));
        // Process decrypted bid details as needed
        
        emit BidRevealed(auctionId);
    }

    function getWinningBid(uint256 auctionId) public view returns (
        uint32 amount,
        address winner,
        bool isRevealed
    ) {
        WinningBid storage wb = winningBids[auctionId];
        return (wb.winningAmount, wb.winner, wb.isRevealed);
    }

    function getBidCount(uint256 auctionId) public view returns (uint256) {
        return bids[auctionId].length;
    }

    function endAuction(uint256 auctionId) public onlyAuctionOwner(auctionId) {
        auctions[auctionId].isActive = false;
        auctions[auctionId].endTime = block.timestamp;
    }
}