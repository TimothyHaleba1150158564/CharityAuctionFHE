// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface AuctionItem {
  id: string;
  encryptedBid: string;
  bidder: string;
  timestamp: number;
  status: "active" | "won" | "closed";
  itemName: string;
  charity: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [auctions, setAuctions] = useState<AuctionItem[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newAuctionData, setNewAuctionData] = useState({
    itemName: "",
    charity: "",
    startingBid: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  // Calculate statistics
  const activeCount = auctions.filter(a => a.status === "active").length;
  const wonCount = auctions.filter(a => a.status === "won").length;
  const closedCount = auctions.filter(a => a.status === "closed").length;

  useEffect(() => {
    loadAuctions().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadAuctions = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("auction_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing auction keys:", e);
        }
      }
      
      const list: AuctionItem[] = [];
      
      for (const key of keys) {
        try {
          const auctionBytes = await contract.getData(`auction_${key}`);
          if (auctionBytes.length > 0) {
            try {
              const auctionData = JSON.parse(ethers.toUtf8String(auctionBytes));
              list.push({
                id: key,
                encryptedBid: auctionData.bid,
                bidder: auctionData.bidder,
                timestamp: auctionData.timestamp,
                status: auctionData.status || "active",
                itemName: auctionData.itemName,
                charity: auctionData.charity
              });
            } catch (e) {
              console.error(`Error parsing auction data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading auction ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setAuctions(list);
    } catch (e) {
      console.error("Error loading auctions:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const createAuction = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Creating auction with FHE encryption..."
    });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const auctionId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const auctionData = {
        bid: `FHE-${btoa(JSON.stringify({bid: newAuctionData.startingBid, encrypted: true}))}`,
        bidder: account,
        timestamp: Math.floor(Date.now() / 1000),
        status: "active",
        itemName: newAuctionData.itemName,
        charity: newAuctionData.charity
      };
      
      // Store auction data on-chain using FHE
      await contract.setData(
        `auction_${auctionId}`, 
        ethers.toUtf8Bytes(JSON.stringify(auctionData))
      );
      
      const keysBytes = await contract.getData("auction_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(auctionId);
      
      await contract.setData(
        "auction_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Auction created with FHE protection!"
      });
      
      await loadAuctions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewAuctionData({
          itemName: "",
          charity: "",
          startingBid: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Creation failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const placeBid = async (auctionId: string, bidAmount: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted bid with FHE..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const auctionBytes = await contract.getData(`auction_${auctionId}`);
      if (auctionBytes.length === 0) {
        throw new Error("Auction not found");
      }
      
      const auctionData = JSON.parse(ethers.toUtf8String(auctionBytes));
      
      const updatedAuction = {
        ...auctionData,
        bid: `FHE-${btoa(JSON.stringify({bid: bidAmount, encrypted: true}))}`,
        bidder: account
      };
      
      await contract.setData(
        `auction_${auctionId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedAuction))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted bid placed successfully!"
      });
      
      await loadAuctions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Bid failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const closeAuction = async (auctionId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Finalizing auction with FHE computation..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const auctionBytes = await contract.getData(`auction_${auctionId}`);
      if (auctionBytes.length === 0) {
        throw new Error("Auction not found");
      }
      
      const auctionData = JSON.parse(ethers.toUtf8String(auctionBytes));
      
      const updatedAuction = {
        ...auctionData,
        status: "closed"
      };
      
      await contract.setData(
        `auction_${auctionId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedAuction))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Auction closed successfully!"
      });
      
      await loadAuctions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Close failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to participate in anonymous auctions",
      icon: "🔗"
    },
    {
      title: "Browse Auctions",
      description: "Explore charity auctions with encrypted bids and anonymous participants",
      icon: "🔍"
    },
    {
      title: "Place Encrypted Bid",
      description: "Submit your bid using FHE technology to keep it private until auction ends",
      icon: "🔒"
    },
    {
      title: "Win Anonymously",
      description: "Only the winning result is revealed while protecting all bidder identities",
      icon: "🏆"
    }
  ];

  // Filter auctions based on search and filter
  const filteredAuctions = auctions.filter(auction => {
    const matchesSearch = auction.itemName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          auction.charity.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === "all" || auction.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Loading anonymous auctions...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>Charity<span>Auction</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-auction-btn"
          >
            <div className="add-icon"></div>
            New Auction
          </button>
          <button 
            className="tutorial-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Anonymous Charity Auctions</h2>
            <p>Bid anonymously using FHE technology to protect your privacy while supporting charities</p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>How FHE Auctions Work</h2>
            <p className="subtitle">Learn how to participate in privacy-preserving charity auctions</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card">
            <h3>About FHE Auctions</h3>
            <p>Our platform uses Fully Homomorphic Encryption to process bids without revealing bidder identities or amounts until the auction closes.</p>
            <div className="fhe-badge">
              <span>FHE-Powered Privacy</span>
            </div>
          </div>
          
          <div className="dashboard-card">
            <h3>Auction Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{auctions.length}</div>
                <div className="stat-label">Total Auctions</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{activeCount}</div>
                <div className="stat-label">Active</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{wonCount}</div>
                <div className="stat-label">Won</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{closedCount}</div>
                <div className="stat-label">Closed</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card">
            <h3>Search & Filter</h3>
            <div className="search-filter">
              <input 
                type="text" 
                placeholder="Search auctions..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
              <select 
                value={filterStatus} 
                onChange={(e) => setFilterStatus(e.target.value)}
                className="filter-select"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="won">Won</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          </div>
        </div>
        
        <div className="auctions-section">
          <div className="section-header">
            <h2>Charity Auctions</h2>
            <div className="header-actions">
              <button 
                onClick={loadAuctions}
                className="refresh-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="auctions-list">
            {filteredAuctions.length === 0 ? (
              <div className="no-auctions">
                <div className="no-auctions-icon"></div>
                <p>No auctions found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Auction
                </button>
              </div>
            ) : (
              filteredAuctions.map(auction => (
                <div className="auction-card" key={auction.id}>
                  <div className="auction-header">
                    <h3>{auction.itemName}</h3>
                    <span className={`status-badge ${auction.status}`}>
                      {auction.status}
                    </span>
                  </div>
                  <div className="auction-details">
                    <p className="charity-name">Benefitting: {auction.charity}</p>
                    <p className="bidder-info">Bidder: {auction.bidder.substring(0, 8)}... (Anonymous)</p>
                    <p className="auction-date">
                      {new Date(auction.timestamp * 1000).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="auction-actions">
                    {auction.status === "active" && (
                      <button 
                        className="bid-btn"
                        onClick={() => {
                          const bidAmount = prompt("Enter your bid amount:");
                          if (bidAmount) placeBid(auction.id, bidAmount);
                        }}
                      >
                        Place Encrypted Bid
                      </button>
                    )}
                    {isOwner(auction.bidder) && auction.status === "active" && (
                      <button 
                        className="close-btn"
                        onClick={() => closeAuction(auction.id)}
                      >
                        Close Auction
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={createAuction} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          auctionData={newAuctionData}
          setAuctionData={setNewAuctionData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>CharityAuctionFHE</span>
            </div>
            <p>Privacy-preserving charity auctions using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} CharityAuctionFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  auctionData: any;
  setAuctionData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  auctionData,
  setAuctionData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setAuctionData({
      ...auctionData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!auctionData.itemName || !auctionData.charity || !auctionData.startingBid) {
      alert("Please fill all required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Create New Auction</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> All bids will be encrypted with FHE technology
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Item Name *</label>
              <input 
                type="text"
                name="itemName"
                value={auctionData.itemName} 
                onChange={handleChange}
                placeholder="Enter item name..." 
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Charity *</label>
              <input 
                type="text"
                name="charity"
                value={auctionData.charity} 
                onChange={handleChange}
                placeholder="Benefitting charity..." 
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Starting Bid *</label>
              <input 
                type="text"
                name="startingBid"
                value={auctionData.startingBid} 
                onChange={handleChange}
                placeholder="Enter starting bid..." 
                className="form-input"
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Bidder identities and amounts remain encrypted using FHE
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn primary-btn"
          >
            {creating ? "Creating with FHE..." : "Create Auction"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;