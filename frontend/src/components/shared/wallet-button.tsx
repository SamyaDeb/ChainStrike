"use client";

import { useSafeWallet } from "@/hooks/useSafeWallet";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { shortenAddress } from "@/lib/utils/format";
import {
  ChevronDown,
  Wallet,
  LogOut,
  Copy,
  ExternalLink,
  Check,
  Loader2,
} from "lucide-react";
import { EXPLORER } from "@/config/networks";

export function WalletButton() {
  const { activeAccount, activeWallet, wallets, isReady } = useSafeWallet();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    if (!wallets) return;
    
    // Find Pera Wallet
    const peraWallet = wallets.find((w) => w.id === "pera");
    if (peraWallet) {
      try {
        setConnecting(true);
        await peraWallet.connect();
      } catch (error) {
        console.error("Failed to connect to Pera Wallet:", error);
      } finally {
        setConnecting(false);
      }
    }
  };

  const handleDisconnect = async () => {
    if (activeWallet) {
      await activeWallet.disconnect();
    }
    setIsDropdownOpen(false);
  };

  const copyAddress = async () => {
    if (activeAccount?.address) {
      await navigator.clipboard.writeText(activeAccount.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Wallet not ready yet
  if (!isReady) {
    return (
      <Button variant="secondary" disabled className="gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading...
      </Button>
    );
  }

  if (activeAccount) {
    return (
      <div className="relative">
        <Button
          variant="secondary"
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="gap-2 border-neon-green/20 hover:border-neon-green/40"
        >
          <div className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
          {shortenAddress(activeAccount.address)}
          <ChevronDown
            className={`h-4 w-4 transition-transform ${
              isDropdownOpen ? "rotate-180" : ""
            }`}
          />
        </Button>

        {isDropdownOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsDropdownOpen(false)}
            />
            <div className="absolute right-0 mt-2 w-56 glass-card p-2 z-50 animate-slide-down">
              <div className="px-3 py-2 border-b border-glass-border mb-2">
                <p className="text-xs text-gray-400">Connected with</p>
                <p className="text-sm font-medium text-neon-green">{activeWallet?.metadata.name}</p>
              </div>

              <button
                onClick={copyAddress}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-glass text-sm text-gray-300 hover:text-white transition-colors"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-neon-green" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copied ? "Copied!" : "Copy Address"}
              </button>

              <a
                href={EXPLORER.address(activeAccount.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-glass text-sm text-gray-300 hover:text-white transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                View on Explorer
              </a>

              <div className="my-2 border-t border-glass-border" />

              <button
                onClick={handleDisconnect}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-loss/20 text-sm text-loss transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Disconnect
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <Button 
      onClick={handleConnect} 
      className="gap-2"
      disabled={connecting || !wallets}
    >
      {connecting ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Connecting...
        </>
      ) : (
        <>
          <Wallet className="h-4 w-4" />
          Connect Wallet
        </>
      )}
    </Button>
  );
}
