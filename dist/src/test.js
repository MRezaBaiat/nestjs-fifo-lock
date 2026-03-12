"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lock_service_1 = require("./lock.service");
const service = new lock_service_1.LockService({
    redisHost: 'localhost',
    redisPort: 6379,
    healthCheckInterval: 500,
    lockMaxTTL: 10000,
    maxExtensions: 3,
    lockAcquireInterval: 500,
});
service.onApplicationBootstrap();
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function test() {
    console.log('starting test');
    service
        .auto(['1', '2', '3'], async () => {
        console.log('1,2,3 locked');
        await sleep(50000);
        console.log('1,2,3 finished');
    })
        .catch(console.error);
    service
        .auto(['1'], async () => {
        console.log('1 locked');
        await sleep(5000);
        console.log('1 finished');
    })
        .catch(console.error);
    service
        .auto(['4'], async () => {
        console.log('4 locked');
        await sleep(5000);
        console.log('4 finished');
    })
        .catch(console.error);
}
test();
