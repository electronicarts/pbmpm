
# PB-MPM
[![BSD3 Clause](https://img.shields.io/badge/license-BSD3_Clause-blue.svg)](LICENSE.md)
[![Version](https://img.shields.io/badge/version-1.0.0-green.svg)](VERSION.md)

This package is a WebGPU implementation of Position Based MPM (PB-MPM).

 <img src="data/blockCrusher.gif"> <img src="data/coiling.gif"> <img src="data/colliders.gif"> <img src="data/splashing.gif">

To see the demo in action, go [here](https://electronicarts.github.io/pbmpm/).

This **Main** branch contains many optimizations that make it harder to understand. For a more accessible version of the code, see the [SIGGRAPH 2024](https://github.com/electronicarts/pbmpm/tree/siggraph2024) branch that is less optimized but more readable.

## Building

PB-MPM is based on WebGPU. Currently, this means that among desktop browsers, **Firefox will not work**.
Some mobile hardware can run WebGPU but this app is not properly mobile-aware so the experience will not be good.

1. [Install Ruby](https://www.ruby-lang.org/en/documentation/installation/). If you are on *MacOS*: Please follow [these instructions](https://jekyllrb.com/docs/installation/macos/). 
2. Run `bundle install`
3. Run `jekyll serve --livereload`
4. Open a browser window at [`localhost:4000`](http://localhost:4000)

## Reference

> *Chris Lewin*. **[A Position Based Material Point Method](https://seed.ea.com)**. ACM SIGGRAPH 2024.

## Authors

<p align="center"><a href="https://seed.ea.com"><img src="data/SEED.jpg" width="150px"></a><br>
<b>Search for Extraordinary Experiences Division (SEED) - Electronic Arts <br> https://seed.ea.com</b><br>
We are a cross-disciplinary team within EA Worldwide Studios.<br>
Our mission is to explore, build and help define the future of interactive entertainment.</p>

## Contributing

Before you can contribute, EA must have a Contributor License Agreement (CLA) on file that has been signed by each contributor.
You can sign here: http://bit.ly/electronic-arts-cla

## Research Resources
- [incremental_mpm](https://github.com/nialltl/incremental_mpm) by nialltl

## License
- The source code is released under a *BSD 3-Clause License* as detailed in [LICENSE.md](LICENSE.md)
