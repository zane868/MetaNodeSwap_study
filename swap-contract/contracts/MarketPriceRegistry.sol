// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./MetaNodeSwap/interfaces/IPoolManager.sol";
import "./MetaNodeSwap/libraries/TickMath.sol";

/// @notice Owner-controlled simulated market reference. It is not an oracle or an execution quote.
contract MarketPriceRegistry is Ownable {
    struct ReferencePrice {
        uint160 sqrtPriceX96;
        uint64 version;
        uint64 updatedAt;
    }

    IPoolManager public immutable poolManager;
    mapping(address => mapping(address => ReferencePrice)) private _prices;

    event PriceUpdated(address indexed token0, address indexed token1, uint160 sqrtPriceX96, uint64 version);
    event PoolRequestedAtReference(address indexed pool, address indexed token0, address indexed token1, uint64 version);

    constructor(address manager) Ownable(msg.sender) {
        require(manager.code.length > 0, "Invalid pool manager");
        poolManager = IPoolManager(manager);
    }

    /// @dev Price is always raw token1/token0 in ascending address order, including decimals.
    function setPrice(address token0, address token1, uint160 sqrtPriceX96) external onlyOwner {
        require(token0 != address(0) && token0 < token1, "Invalid token order");
        require(token0.code.length > 0 && token1.code.length > 0, "Tokens must be contracts");
        require(sqrtPriceX96 > TickMath.MIN_SQRT_PRICE && sqrtPriceX96 < TickMath.MAX_SQRT_PRICE, "Price out of range");
        ReferencePrice storage price = _prices[token0][token1];
        price.sqrtPriceX96 = sqrtPriceX96;
        price.version += 1;
        price.updatedAt = uint64(block.timestamp);
        emit PriceUpdated(token0, token1, sqrtPriceX96, price.version);
    }

    function getPrice(address tokenA, address tokenB) external view returns (ReferencePrice memory) {
        (address token0, address token1) = _sort(tokenA, tokenB);
        return _prices[token0][token1];
    }

    /// @notice Anyone may create a pool using the latest configured price without supplying a price.
    /// @dev Existing pools are returned unchanged by PoolManager; owner updates never reset them.
    function createPoolAtReference(
        address tokenA,
        address tokenB,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        uint64 expectedVersion
    ) external returns (address pool) {
        (address token0, address token1) = _sort(tokenA, tokenB);
        ReferencePrice memory price = _prices[token0][token1];
        require(price.version != 0, "Reference price not configured");
        require(price.version == expectedVersion, "Reference price changed");
        require(tickLower >= TickMath.MIN_TICK && tickUpper <= TickMath.MAX_TICK && tickLower < tickUpper, "Invalid ticks");
        int24 tick = TickMath.getTickAtSqrtPrice(price.sqrtPriceX96);
        require(tick >= tickLower && tick < tickUpper, "Reference price outside range");
        pool = poolManager.createAndInitializePoolIfNecessary(IPoolManager.CreateAndInitializeParams({
            token0: token0,
            token1: token1,
            fee: fee,
            tickLower: tickLower,
            tickUpper: tickUpper,
            sqrtPriceX96: price.sqrtPriceX96
        }));
        emit PoolRequestedAtReference(pool, token0, token1, price.version);
    }

    function _sort(address tokenA, address tokenB) private pure returns (address token0, address token1) {
        require(tokenA != address(0) && tokenB != address(0) && tokenA != tokenB, "Invalid token pair");
        return tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    }
}
