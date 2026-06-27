import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
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
        @Body()
        body: {
            name?: string;
            tableId?: number;
            responsibleUserId?: number;
            createdByUserId?: number;
        },
    ) {
        return this.invoicesService.create(body);
    }

    @Patch(':id')
    update(
        @Param('id') id: string,
        @Body()
        body: {
            name?: string;
            status?: string;
            actorUserId?: number;
        },
    ) {
        return this.invoicesService.update(Number(id), body);
    }

    @Patch(':id/move-table')
    moveToTable(
        @Param('id') id: string,
        @Body()
        body: {
            tableId: number | null;
            actorUserId?: number;
        },
    ) {
        return this.invoicesService.moveToTable(Number(id), body);
    }

    @Patch(':id/move-user')
    moveToUser(
        @Param('id') id: string,
        @Body()
        body: {
            responsibleUserId: number;
            actorUserId?: number;
        },
    ) {
        return this.invoicesService.moveToUser(Number(id), body);
    }

    @Patch(':id/request-payment')
    requestPayment(
        @Param('id') id: string,
        @Body()
        body: {
            actorUserId?: number;
        },
    ) {
        return this.invoicesService.requestPayment(Number(id), body);
    }

    @Patch(':id/payment')
    updatePayment(
        @Param('id') id: string,
        @Body()
        body: {
            cashPaid?: number;
            cardPaid?: number;
            actorUserId?: number;
        },
    ) {
        return this.invoicesService.updatePayment(Number(id), body);
    }

    @Patch(':id/validate-paid')
    validatePaid(
        @Param('id') id: string,
        @Body()
        body: {
            actorUserId?: number;
        },
    ) {
        return this.invoicesService.validatePaid(Number(id), body);
    }
}