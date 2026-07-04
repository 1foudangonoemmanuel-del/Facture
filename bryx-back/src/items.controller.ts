import { Body, Controller, Delete, Param, Patch, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard';
import { ItemsService } from './items.service';

@Controller()
export class ItemsController {
    constructor(private readonly itemsService: ItemsService) { }

    @Post('api/invoices/:invoiceId/items')
    create(
        @Req() request: AuthenticatedRequest,
        @Param('invoiceId') invoiceId: string,
        @Body()
        body: {
            productId?: number;
            name?: string;
            quantity?: number;
            unitPrice?: number;
        },
    ) {
        return this.itemsService.create(Number(invoiceId), {
            ...body,
            actorUserId: request.user.id,
        });
    }

    @Patch('api/items/:id')
    update(
        @Req() request: AuthenticatedRequest,
        @Param('id') id: string,
        @Body()
        body: {
            name?: string;
            quantity?: number;
            unitPrice?: number;
        },
    ) {
        return this.itemsService.update(Number(id), {
            ...body,
            actorUserId: request.user.id,
        });
    }

    @Delete('api/items/:id')
    remove(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
        return this.itemsService.remove(Number(id), request.user.id);
    }
}
