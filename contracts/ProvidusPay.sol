// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title ProvidusPay — B4A non-custodial EVM payment router (immediate forwarding only).
/// @notice Never holds funds. Native is forwarded via call; ERC20 uses pull pattern.
contract ProvidusPay is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    event PaymentExecuted(
        bytes32 indexed intentId,
        address indexed payer,
        address indexed recipient,
        address token,
        uint256 amount
    );

    mapping(address => bool) public allowedTokens;
    mapping(address => mapping(bytes32 => bool)) public usedIntents;

    constructor(address[] memory initialAllowedTokens) Ownable(msg.sender) {
        for (uint256 i = 0; i < initialAllowedTokens.length; i++) {
            address t = initialAllowedTokens[i];
            require(t != address(0), "ProvidusPay: zero token");
            allowedTokens[t] = true;
        }
    }

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        require(token != address(0), "ProvidusPay: zero token");
        allowedTokens[token] = allowed;
    }

    function payNative(
        bytes32 intentId,
        address payable recipient,
        uint256 deadline
    ) external payable nonReentrant {
        require(msg.value > 0, "ProvidusPay: zero amount");
        require(recipient != address(0), "ProvidusPay: zero recipient");
        require(deadline >= block.timestamp, "ProvidusPay: expired deadline");
        require(!usedIntents[msg.sender][intentId], "ProvidusPay: intent already used");
        usedIntents[msg.sender][intentId] = true;
        (bool ok, ) = recipient.call{value: msg.value}("");
        require(ok, "ProvidusPay: native forward failed");
        emit PaymentExecuted(intentId, msg.sender, recipient, address(0), msg.value);
    }

    function payToken(
        bytes32 intentId,
        address token,
        address recipient,
        uint256 amount,
        uint256 deadline
    ) external nonReentrant {
        require(amount > 0, "ProvidusPay: zero amount");
        require(recipient != address(0), "ProvidusPay: zero recipient");
        require(deadline >= block.timestamp, "ProvidusPay: expired deadline");
        require(allowedTokens[token], "ProvidusPay: token not allowed");
        require(!usedIntents[msg.sender][intentId], "ProvidusPay: intent already used");
        usedIntents[msg.sender][intentId] = true;
        SafeERC20.safeTransferFrom(IERC20(token), msg.sender, recipient, amount);
        emit PaymentExecuted(intentId, msg.sender, recipient, token, amount);
    }
}
