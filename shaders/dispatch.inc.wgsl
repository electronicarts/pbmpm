//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

//!insert DispatchSizes

fn divUp(threadCount : u32, divisor : u32) -> u32
{
    return (threadCount + divisor - 1) / divisor;
}
