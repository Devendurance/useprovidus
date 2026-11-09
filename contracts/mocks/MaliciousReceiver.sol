// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IProvidusPay {
    function payNative(bytes32 intentId, address payable recipient, uint256 deadline) external payable;
    function payToken(bytes32 intentId, address token, address recipient, uint256 amount, uint256 deadline) external;
}

contract MaliciousReceiver {
    address payable public target;
    address public tokenAddr;
    bytes32 public reentryNativeIntent;
    bytes32 public reentryTokenIntent;
    bool public nativeReentrySuccess;
    bool public tokenReentrySuccess;
    bool private entered;

    constructor() payable {}

    function armToken(address _token, bytes32 _reentryNative, bytes32 _reentryToken) external {
        tokenAddr = _token;
        reentryNativeIntent = _reentryNative;
        reentryTokenIntent = _reentryToken;
    }

    function attackNative(
        address payable _target,
        bytes32 _intentId,
        address payable _recipient,
        uint256 _deadline
    ) external payable {
        target = _target;
        entered = false;
        nativeReentrySuccess = false;
        tokenReentrySuccess = false;
        IProvidusPay(_target).payNative{value: msg.value}(_intentId, _recipient, _deadline);
    }

    function attackToken(
        address _target,
        bytes32 _intentId,
        address _token,
        address _recipient,
        uint256 _amount,
        uint256 _deadline
    ) external {
        target = payable(_target);
        IProvidusPay(_target).payToken(_intentId, _token, _recipient, _amount, _deadline);
    }

    receive() external payable {
        if (target == address(0) || entered) {
            return;
        }
        entered = true;
        if (address(this).balance >= 1 && reentryNativeIntent != bytes32(0)) {
            try IProvidusPay(target).payNative{value: 1}(
                reentryNativeIntent,
                payable(address(this)),
                block.timestamp + 3600
            ) {
                nativeReentrySuccess = true;
            } catch {
                nativeReentrySuccess = false;
            }
        }
        if (tokenAddr != address(0) && reentryTokenIntent != bytes32(0)) {
            IERC20(tokenAddr).approve(target, 1);
            try IProvidusPay(target).payToken(
                reentryTokenIntent,
                tokenAddr,
                address(this),
                1,
                block.timestamp + 3600
            ) {
                tokenReentrySuccess = true;
            } catch {
                tokenReentrySuccess = false;
            }
        }
    }
}
