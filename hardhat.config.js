/* eslint-disable @typescript-eslint/no-require-imports */
require("@nomicfoundation/hardhat-toolbox");
module.exports = { solidity: "0.8.24", networks: { hardhat: {}, botTestnet: { url: "https://rpc.bohr.life", chainId: 968 }, botMainnet: { url: "https://rpc.botchain.ai", chainId: 677 } }, paths: { sources: "./contracts", tests: "./test", cache: "./cache", artifacts: "./artifacts" } };
