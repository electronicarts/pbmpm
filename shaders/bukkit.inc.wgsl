//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

//!include simConstants.inc

fn bukkitAddressToIndex(address: vec2u, bukkitCountX: u32) -> u32
{
    return address.y*bukkitCountX + address.x;
}

fn positionToBukkitId(position: vec2f) -> vec2i
{
    return vec2i((position) / f32(BukkitSize));
}

struct BukkitThreadData
{
    rangeStart: u32,
    rangeCount: u32,
    bukkitX: u32,
    bukkitY: u32,
};