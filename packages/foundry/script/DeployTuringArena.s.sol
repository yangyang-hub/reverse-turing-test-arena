// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DeployHelpers.s.sol";
import "../contracts/TuringArena.sol";

contract DeployTuringArena is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        // Deploy TuringArena with deployer as protocol treasury
        new TuringArena(deployer);
    }
}
