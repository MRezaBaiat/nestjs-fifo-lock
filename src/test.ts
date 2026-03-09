import { LockService } from './lock.service';

const service = new LockService({
  redisHost: 'localhost',
  redisPort: 6379,
  healthCheckInterval: 500,
  lockMaxTTL: 10000,
  maxExtensions: 1,
  lockAcquireInterval: 500,
});
service.onApplicationBootstrap();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function test() {
  console.log('starting test');
  service
    .auto(['1', '2', '3'], async () => {
      console.log('1,2,3 locked');
      await sleep(5000);
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
  /*service.auto(['2'], async () => {
    console.log('2 locked');
    await sleep(5000);
    console.log('2 finished');
  });
  service.auto(['3'], async () => {
    console.log('3 locked');
    await sleep(5000);
    console.log('3 finished');
  });*/
}
test();
