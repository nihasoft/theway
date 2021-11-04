import * as Http from 'http';
import * as Https from 'https';
import { readFileSync } from 'fs';
import * as SwaggerUi from 'swagger-ui-express';

import { Observable, Subscriber, zip } from 'rxjs';
import { map, take } from 'rxjs/operators';

import express = require('express');
import morgan = require('morgan');
import helmet = require('helmet');
import cors = require('cors');
import bodyParser = require('body-parser');

import { Configuration }  from '../decorator/component/configuration.decorator';
import { Inject } from '../decorator/component/inject.decorator';
import { PropertiesHandler } from '../handler/properties.handler';
import { PropertyModel } from '../shared/model/property.model';
import { System } from '../decorator/component/system.decorator';
import { Configurable } from '../shared/abstract/configurable';
import { CoreLogger } from '../service/core-logger';
import { CoreMessageService } from '../service/core-message.service';
import { ApplicationException } from '../exeption/application.exception';
import { HttpTypeEnum } from '../shared/enum/http-type.enum';

/*
    eslint-disable @typescript-eslint/ban-types,
    @typescript-eslint/no-explicit-any,
    @typescript-eslint/explicit-module-boundary-types
*/
/**
 *   @name ServerConfiguration
 *   @description The ServerConfiguration is responsible to start
 *      the http/https server with some features.
 *   @since 1.0.0
 */
@System
@Configuration()
export class ServerConfiguration extends Configurable {
    @Inject logger: CoreLogger;
    @Inject propertiesHandler: PropertiesHandler;

    protected httpProperties: PropertyModel;
    public httpServer: Http.Server;
    protected httpsProperties: PropertyModel;
    public httpsServer: Https.Server;
    protected serverProperties: PropertyModel;
    protected serverContext: any;

    protected buildCredentialsOptions(httpsProperties: PropertyModel): { key: string; cert: string } {
        const privateKey = readFileSync(httpsProperties['key-path'] as string, 'utf8');
        const certificate = readFileSync(httpsProperties['cert-path'] as string, 'utf8');

        return { key: privateKey, cert: certificate };
    }
    private buildPath(fileProperty: any, beginPath: string): string {
        let path = fileProperty.path as string;
        if (!fileProperty.full) {
            if (path.charAt(0) !== '/') {
                path = '/' + path;
            }
            path = beginPath + path;
        }
        return path;
    }
    /**
     *   @method configure
     *   @description This method is called when the class is built and will
     *      configure and start the server.
     *   @since 1.0.0
     */
    public configure(): void | Observable<void> {
        this.serverProperties = this.propertiesHandler.getProperties('the-way.server') as PropertyModel;
        this.httpProperties = this.serverProperties.http as PropertyModel;
        this.httpsProperties = this.serverProperties.https as PropertyModel;

        if (this.serverProperties.enabled !== true) {
            return;
        } else {
            return this.start();
        }
    }
    protected destroyHttpServer(): Observable<void> {
        return new Observable<void>((observer: Subscriber<void>) => {
            if (this.httpServer) {
                this.httpServer.close(() => {
                    observer.next();
                });
            } else {
                observer.next();
            }
        });
    }
    protected destroyHttpsServer(): Observable<void> {
        return new Observable<void>((observer: Subscriber<void>) => {
            if (this.httpsServer) {
                this.httpsServer.close(() => {
                    observer.next();
                });
            } else {
                observer.next();
            }
        });
    }
    /**
     *   @method destroy
     *   @description Will be called when the CoreState change to DESTRUCTION_STARTED
     *   @since 1.0.0
     */
    public destroy(): Observable<undefined> {
        return zip(
            this.destroyHttpServer().pipe(take(1)),
            this.destroyHttpsServer().pipe(take(1))
        ).pipe(
            map(() => undefined)
        );
    }
    protected handleServer(
        observer: Subscriber<void>,
        server: Http.Server | Https.Server,
        properties: PropertyModel
    ): void {
        const messageKey = (server instanceof Http.Server) ? 'http-server-running' : 'https-server-running';
        server.listen(properties.port, () => {
            this.logger.info(CoreMessageService.getMessage(messageKey, [properties.port as string]),'[The Way]');
            observer.next();
        });
        server.on('error', (error: any) => {
            observer.error(
                new ApplicationException(
                    CoreMessageService.getMessage('error-server', [error.code]),
                    CoreMessageService.getMessage('TW-012'),
                    error
                )
            );
        });
    }
    protected initializeExpress(): void {
        const helmetProperties = this.serverProperties.helmet as PropertyModel;
        const corsProperties = this.serverProperties.cors as PropertyModel;

        if (this.httpProperties.enabled && (this.serverProperties.file as PropertyModel).enabled) {
            helmetProperties.contentSecurityPolicy = false;
        }

        this.serverContext = express();

        if (helmetProperties.enabled) {
            this.initializeExpressHelmet(helmetProperties);
        }
        if (corsProperties.enabled) {
            this.initializeExpressCors(corsProperties);
        }
        if (this.serverProperties['operations-log']) {
            this.initializeExpressOperationsLog();
        }

        this.registerMiddleware(bodyParser.json());
        this.registerMiddleware(bodyParser.urlencoded({ extended: false }));
    }
    protected initializeExpressHelmet(helmetProperties: any): void {
        delete helmetProperties.enabled;
        this.registerMiddleware(helmet(helmetProperties));
    }
    protected initializeExpressCors(corsProperties: any): any {
        delete corsProperties.enabled;
        this.registerMiddleware(cors(corsProperties));
    }
    protected initializeExpressOperationsLog(): any {
        this.registerMiddleware(morgan('dev'));
    }
    private initializeFileServer(): void {
        this.logger.debug(CoreMessageService.getMessage('http-file-enabled'), '[The Way]');
        const fileProperties = this.serverProperties.file as any;
        const filePath: string = this.buildPath(fileProperties, process.cwd());

        const assetsProperty = fileProperties.assets as any;
        const staticProperty = fileProperties.static as any;

        if (assetsProperty.enabled) {
            this.serverContext.use('/assets', express.static(this.buildPath(assetsProperty, filePath)));
        }

        if (staticProperty.enabled) {
            this.serverContext.use('/static', express.static(this.buildPath(staticProperty, filePath)));
        }

        this.serverContext.get('/*', (req: any, res: any, next: any) => {
            if (req.path === '/' || (fileProperties.fallback && !this.isApiPath(req.path))) {
                res.sendFile(filePath + '/index.html');
            } else {
                next();
            }
        });
    }
    protected initializeHttpServer(): Observable<void> {
        return new Observable<void>((observer: Subscriber<void>) => {
            if (!this.httpProperties.enabled) {
                observer.next();
            } else {
                this.httpServer = Http.createServer(this.serverContext);
                this.handleServer(observer, this.httpServer, this.httpProperties);
            }
        });
    }
    protected initializeHttpsServer(): Observable<void> {
        return new Observable<void>((observer: Subscriber<void>) => {
            if (!this.httpsProperties.enabled) {
                observer.next();
            } else {
                const credentials = this.buildCredentialsOptions(this.httpsProperties);
                this.httpsServer = Https.createServer(credentials, this.serverContext);
                this.handleServer(observer, this.httpsServer, this.httpsProperties);
            }
        });
    }
    protected initializeServer(): Observable<undefined> {
        return zip(
            this.initializeHttpServer().pipe(take(1)),
            this.initializeHttpsServer().pipe(take(1))
        ).pipe(map(() => undefined));
    }
    protected initializeSwagger(): void {
        this.logger.debug(CoreMessageService.getMessage('http-swagger-enabled'), '[The Way]');
        const restProperties = this.serverProperties.rest as any;
        const swaggerProperties = restProperties.swagger;

        const swaggerDoc = readFileSync(this.buildPath(swaggerProperties.file, process.cwd()));
        this.serverContext.use(
            restProperties.path + swaggerProperties['api-path'],
            SwaggerUi.serve,
            SwaggerUi.setup(JSON.parse(swaggerDoc.toString()))
        );
    }
    protected isApiPath(path: string): boolean {
        const rest = (this.serverProperties.rest as PropertyModel) as PropertyModel;
        return path.includes(rest.path as string);
    }
    protected isFileServerEnabled(): boolean {
        const fileProperties = this.serverProperties.file  as PropertyModel;
        return fileProperties &&
            fileProperties.enabled as boolean;
    }
    protected isSwaggerEnabled(): boolean {
        const swagger = (this.serverProperties.rest as PropertyModel).swagger as PropertyModel;
        return swagger !== undefined &&
            (swagger as PropertyModel).enabled as boolean;
    }
    /**
     *   @method registerPath
     *   @description This method will register any REST path in the server and enable.
     *   @since 1.0.0
     *   @param path The path to be registered
     *   @param httpType The operation type for the path
     *   @param executor the "function" that will execute
     */
    public registerPath(path: string, httpType: HttpTypeEnum, executor: any): void {
        const restProperties = this.serverProperties.rest as any;
        const finalPath = restProperties.path + path;

        this.logger.debug('Registered - ' + httpType.toUpperCase() + ' ' + finalPath, '[The Way]');
        this.serverContext[httpType](finalPath, executor);
    }
    /**
     *   @method registerMiddleware
     *   @description With this method you can enable some middlewares
     *      (for express) in the server, like body parser, helmet and others.
     *   @since 1.0.0
     *   @param middlewareFunction The middleware function that will be
     *      used in express context
     */
    public registerMiddleware(middlewareFunction: any): void {
        this.serverContext.use(middlewareFunction);
    }
    protected start(): Observable<void> {
        this.logger.info(CoreMessageService.getMessage('http-server-initialization'), '[The Way]');

        if (!this.httpProperties.enabled && !this.httpsProperties.enabled) {
            throw new ApplicationException(
                CoreMessageService.getMessage('error-server-not-enabled'),
                CoreMessageService.getMessage('TW-011')
            );
        }

        this.initializeExpress();

        if (this.isSwaggerEnabled()) {
            this.initializeSwagger();
        }

        if (this.isFileServerEnabled())   {
            this.initializeFileServer();
        }
        return this.initializeServer();
    }
}
