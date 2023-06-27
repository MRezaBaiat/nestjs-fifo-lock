"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var LockModule_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.LockModule = void 0;
const common_1 = require("@nestjs/common");
const lock_service_1 = require("./lock.service");
let LockModule = exports.LockModule = LockModule_1 = class LockModule {
    static register(config) {
        config.lockMaxTTL = config.lockMaxTTL || 60 * 1000;
        config.healthCheckInterval = config.healthCheckInterval || 60 * 1000;
        config.lockAcquireInterval = config.lockAcquireInterval || 500;
        config.lockDefaultDuration = config.lockDefaultDuration || 10000;
        return {
            global: true,
            imports: [],
            module: LockModule_1,
            providers: [
                {
                    provide: lock_service_1.LockService,
                    useValue: new lock_service_1.LockService(config),
                },
            ],
            exports: [lock_service_1.LockService],
        };
    }
};
exports.LockModule = LockModule = LockModule_1 = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({})
], LockModule);