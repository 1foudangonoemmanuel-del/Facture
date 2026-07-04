import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { Roles } from './auth.decorators';
import type { AuthenticatedRequest } from './auth.guard';
import { UsersService } from './users.service';

@Controller('api/users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Get()
    findAll() {
        return this.usersService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.usersService.findOne(Number(id));
    }

    @Post()
    @Roles('ADMIN')
    create(
        @Req() request: AuthenticatedRequest,
        @Body()
        body: {
            name: string;
            pin?: string;
            role?: string;
        },
    ) {
        return this.usersService.create({
            ...body,
            actorUserId: request.user.id,
        });
    }

    @Patch(':id/role')
    @Roles('ADMIN')
    updateRole(
        @Req() request: AuthenticatedRequest,
        @Param('id') id: string,
        @Body()
        body: {
            role: string;
        },
    ) {
        return this.usersService.updateRole(Number(id), {
            ...body,
            actorUserId: request.user.id,
        });
    }

    @Patch(':id/block')
    @Roles('ADMIN')
    blockUser(
        @Req() request: AuthenticatedRequest,
        @Param('id') id: string,
    ) {
        return this.usersService.blockUser(Number(id), request.user.id);
    }

    @Patch(':id/unblock')
    @Roles('ADMIN')
    unblockUser(
        @Req() request: AuthenticatedRequest,
        @Param('id') id: string,
    ) {
        return this.usersService.unblockUser(Number(id), request.user.id);
    }

    @Delete(':id')
    @Roles('ADMIN')
    deleteUser(
        @Req() request: AuthenticatedRequest,
        @Param('id') id: string,
    ) {
        return this.usersService.deleteUser(Number(id), request.user.id);
    }
}
