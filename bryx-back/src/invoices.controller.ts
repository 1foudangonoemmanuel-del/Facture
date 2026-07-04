import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { Roles } from './auth.decorators';
import type { AuthenticatedRequest } from './auth.guard';
import { InvoicesService } from './invoices.service';

@Controller('api/invoices')
export class InvoicesController {
    constructor(private readonly invoicesService: InvoicesService) { }

    @Get()
    findAll() {
        return this.invoicesService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.invoicesService.findOne(Number(id));
    }

    @Post()
    create(
        @Req() request: AuthenticatedRequest,
        @Body()
        body: {
            name?: string;
            tableId?: number;
            responsibleUserId?: number;
        },
    ) {
        return this.invoicesService.create({
            ...body,
            createdByUserId: request.user.id,
        });
    }

    @Patch(':id')
    update(
        @Req() request: AuthenticatedRequest,
        @Param('id') id: string,
        @Body()
        body: {
            name?: string;
            status?: string;
        },
    ) {
        if (body.status === 'CANCELLED' && !['ADMIN', 'MANAGER', 'CAISSE'].includes(request.user.role)) {
            throw new ForbiddenException('Annuler une facture est réservé à la caisse, au manager ou à l’admin');
        }

        return this.invoicesService.update(Number(id), {
            ...body,
            actorUserId: request.user.id,
        });
    }

    @Patch(':id/move-table')
    moveToTable(
        @Req() request: AuthenticatedRequest,
        @Param('id') id: string,
        @Body()
        body: {
            tableId: number | null;
        },
    ) {
        return this.invoicesService.moveToTable(Number(id), {
            ...body,
            actorUserId: request.user.id,
            actorRole: request.user.role,
        });
    }

    @Patch(':id/move-user')
    @Roles('ADMIN', 'MANAGER', 'CAISSE')
    moveToUser(
        @Req() request: AuthenticatedRequest,
        @Param('id') id: string,
        @Body()
        body: {
            responsibleUserId: number;
        },
    ) {
        return this.invoicesService.moveToUser(Number(id), {
            ...body,
            actorUserId: request.user.id,
        });
    }

    @Patch(':id/request-payment')
    requestPayment(
        @Req() request: AuthenticatedRequest,
        @Param('id') id: string,
    ) {
        return this.invoicesService.requestPayment(Number(id), {
            actorUserId: request.user.id,
        });
    }

    @Patch(':id/payment')
    updatePayment(
        @Req() request: AuthenticatedRequest,
        @Param('id') id: string,
        @Body()
        body: {
            cashPaid?: number;
            cardPaid?: number;
        },
    ) {
        return this.invoicesService.updatePayment(Number(id), {
            ...body,
            actorUserId: request.user.id,
        });
    }

    @Patch(':id/validate-paid')
    @Roles('ADMIN', 'MANAGER', 'CAISSE')
    validatePaid(
        @Req() request: AuthenticatedRequest,
        @Param('id') id: string,
    ) {
        return this.invoicesService.validatePaid(Number(id), {
            actorUserId: request.user.id,
        });
    }
}
