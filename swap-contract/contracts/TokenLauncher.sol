// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed-supply test token. All tokens belong to the wallet that launches it.
contract ReleasedToken is ERC20 {
    constructor(string memory name_, string memory symbol_, address recipient)
        ERC20(name_, symbol_)
    {
        _mint(recipient, 100_000 * 10 ** 18);
    }
}

/// @notice Public Sepolia token registry used by the token and pool selectors.
contract TokenLauncher {
    struct TokenInfo {
        address token;
        address creator;
        string name;
        string symbol;
    }

    TokenInfo[] private _tokens;
    event TokenCreated(address indexed token, address indexed creator, string name, string symbol);

    function createToken(string calldata name, string calldata symbol) external returns (address token) {
        require(bytes(name).length > 0 && bytes(name).length <= 96, "Invalid name length");
        require(bytes(symbol).length > 0 && bytes(symbol).length <= 16, "Invalid symbol length");
        token = address(new ReleasedToken(name, symbol, msg.sender));
        _tokens.push(TokenInfo(token, msg.sender, name, symbol));
        emit TokenCreated(token, msg.sender, name, symbol);
    }

    function tokenCount() external view returns (uint256) {
        return _tokens.length;
    }

    function getTokens(uint256 offset, uint256 limit) external view returns (TokenInfo[] memory result) {
        require(limit <= 100, "Page too large");
        if (offset >= _tokens.length) return new TokenInfo[](0);
        uint256 length = _tokens.length - offset;
        if (length > limit) length = limit;
        result = new TokenInfo[](length);
        for (uint256 i; i < length; ++i) result[i] = _tokens[offset + i];
    }
}
