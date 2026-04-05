"use client";

import { useSafeWallet } from "@/hooks/useSafeWallet";
import { X, Loader2 } from "lucide-react";
import { useState } from "react";
import Image from "next/image";

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WalletModal({ isOpen, onClose }: WalletModalProps) {
  const { wallets, isReady } = useSafeWallet();
  const [connecting, setConnecting] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConnect = async (walletId: string) => {
    if (!wallets) return;
    
    const wallet = wallets.find((w) => w.id === walletId);
    if (wallet) {
      try {
        setConnecting(walletId);
        await wallet.connect();
        onClose();
      } catch (error) {
        console.error("Failed to connect:", error);
      } finally {
        setConnecting(null);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative glass-card w-full max-w-md mx-4 animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-glass-border">
          <div>
            <h2 className="text-xl font-bold">Connect Wallet</h2>
            <p className="text-sm text-gray-400 mt-1">Connect your Algorand wallet</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-glass transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Wallet Options */}
        <div className="p-6 space-y-3">
          {!isReady ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              <span className="ml-2 text-gray-400">Loading wallets...</span>
            </div>
          ) : wallets && wallets.length > 0 ? (
            wallets.map((wallet) => (
              <button
                key={wallet.id}
                onClick={() => handleConnect(wallet.id)}
                disabled={connecting !== null}
                className="w-full flex items-center gap-4 p-4 rounded-xl bg-dark-700 hover:bg-dark-600 border border-glass-border hover:border-neon-green/50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="w-10 h-10 rounded-lg bg-dark-800 flex items-center justify-center overflow-hidden">
                  {wallet.metadata.icon ? (
                    <Image
                      src={wallet.metadata.icon}
                      alt={wallet.metadata.name}
                      width={24}
                      height={24}
                      className="w-6 h-6"
                      unoptimized
                    />
                  ) : (
                    <span className="text-lg font-bold text-neon-green">
                      {wallet.metadata.name[0]}
                    </span>
                  )}
                </div>
                <div className="flex-1 text-left">
                  <div className="font-semibold">{wallet.metadata.name}</div>
                  <div className="text-sm text-gray-400">
                    {wallet.isConnected ? "Connected" : "Click to connect"}
                  </div>
                </div>
                {connecting === wallet.id ? (
                  <Loader2 className="h-5 w-5 animate-spin text-neon-green" />
                ) : wallet.isConnected ? (
                  <div className="w-2 h-2 rounded-full bg-profit" />
                ) : null}
              </button>
            ))
          ) : (
            <div className="text-center py-8 text-gray-400">
              No wallets available
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 pt-0">
          <div className="bg-neon-blue/10 border border-neon-blue/20 rounded-lg p-4 mb-4">
            <p className="text-xs text-gray-400 text-center">
              <span className="text-neon-blue font-semibold">Algorand TestNet</span> • 
              Get free TestNet ALGO from{" "}
              <a 
                href="https://bank.testnet.algorand.network/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-neon-blue hover:underline"
              >
                Algorand Dispenser
              </a>
            </p>
          </div>
          <p className="text-center text-xs text-gray-500">
            By connecting, you agree to our Terms of Service
          </p>
        </div>
      </div>
    </div>
  );
}
