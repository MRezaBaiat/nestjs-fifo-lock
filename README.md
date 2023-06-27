## NestJS FIFO Lock

An optimized and fast "First In First Out" lock built on top of the redis and nestjs

## Installation

```bash
$ npm install nestjs-fifo-lock
```

## Usage

To use it first you will need to import the module

```bash
import { LockModule } from 'nestjs-fifo-lock';

@Module({
imports:[{
  LockModule.register({
    redisHost: 'localhost',
    redisPort: 6379,
    lockMaxTTL: 60000,
    healthCheckInterval: 60000,
    lockAcquireInterval: 500
  })
  ...
}])
```

and then simply add a decorator to absolutely any async function you wish

```bash
import { UseLock } from 'nestjs-fifo-lock';

//single lock

@UseLock(({field1})=>({type :'general',tag: field1.id}))
async function doSmtSerious(data:{field1}){
  ...
}

// or an array of lock contexts

@UseLock(({field1,field2})=>([{type :'general',tag: field1.id},{type :'general',tag: field2.id}]))
async function doSmtSerious(data:{field1,field2}){
  ...
}
```

When calling the function decorated with this param , arguments of that function will also be passed to the call back of `UseLock` ,
granting you access to the function's arguments so you can use them to determine lock queue's name.

To make sure the lock does not linger in the redis after the requester service has gone down for
any reason , a health check sweeper is built internally which runs every `healthCheckInterval` milliseconds
and will delete the lock requests older than `lockMaxTTL` milliseconds

#### Hint
Please note if using on multiple server instances connected to the same redis instance , make sure they have their time and dates in sync

## Params

| Project                | requirement                                 | Description                                                                  |
|------------------------|---------------------------------------------|------------------------------------------------------------------------------|
| redisHost              | required                                    | Redis's address                                                              |
| redisPort              | required                                    | Redis's port                                                                 |
| lockMaxTTL             | optional , defaulted to 600000 milliseconds | The time it takes before the internal healthcheck's sweeper deletes the lock |
| healthCheckInterval    | optional, defaulted to 600000 milliseconds  | The interval for how often the healthcheck should run                        |
| lockAcquireInterval  | [ optional , default to 500 milliseconds    | The interval for how often a lock in queue should check to see if it's turn  |

## Credits

Special thanks to my dear friend ,  [Godwin Odo Kalu](https://github.com/Godwin324)
