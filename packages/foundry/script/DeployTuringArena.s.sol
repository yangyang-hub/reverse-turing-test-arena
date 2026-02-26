// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import "../contracts/TuringArena.sol";
import "../contracts/mocks/MockUSDC.sol";

contract DeployTuringArena is ScaffoldETHDeploy {
    // Monad Testnet (chainId 10143) USDC address
    address constant MONAD_TESTNET_USDC = 0x534b2f3A21130d7a60830c2Df862319e593943A3;

    function run() external ScaffoldEthDeployerRunner {
        address usdcAddress;

        if (block.chainid == 10143) {
            // Monad Testnet: use existing USDC
            usdcAddress = MONAD_TESTNET_USDC;
        } else {
            // Local / other networks: deploy MockUSDC
            MockUSDC usdc = new MockUSDC();
            usdcAddress = address(usdc);

            // On local Anvil (chainId 31337), mint USDC to test accounts
            if (block.chainid == 31337) {
                address[4] memory testAccounts = [
                    0x70997970C51812dc3A010C7d01b50e0d17dc79C8,
                    0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC,
                    0x90F79bf6EB2c4f870365E785982E1f101E93b906,
                    0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65
                ];
                for (uint256 i = 0; i < testAccounts.length; i++) {
                    usdc.mint(testAccounts[i], 10_000e6);
                }
                usdc.mint(deployer, 10_000e6);
            }
        }

        // Deploy TuringArena with deployer as treasury
        TuringArena arena = new TuringArena(deployer, usdcAddress);

        // Suppress unused variable warnings
        arena;
    }
}
