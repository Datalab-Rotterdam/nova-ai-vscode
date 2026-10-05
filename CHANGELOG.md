# [1.0.0-alpha.17](https://github.com/Datalab-Rotterdam/nova-ai-vscode/compare/v1.0.0-alpha.16...v1.0.0-alpha.17) (2026-10-05)


### Bug Fixes

* **panel:** replies keep their model; warn when a switch outgrows the context ([7e86698](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/7e86698fbb710f06dc758e8882ba4efe6d4ac16a))
* **permissions:** equivalent tool names match each other's rules ([ad4daee](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/ad4daee182aed462e30ed705e32c6aa598d065e3))
* **permissions:** per-segment command rules and private "Always allow" ([a78cad2](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/a78cad2f3a9fc93bd209a5ee4fdb5c4489bfa0f4))


### Features

* **memory:** typed memory notes shared with nova-ai-cli ([a1d24ce](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/a1d24ce583e2b951334b760f6afcdb8810a05d96))
* **panel:** Chats page to browse, search, rename and delete conversations ([74796d9](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/74796d95ca83c649a25b7baaa68b5cba6cee5d8d))
* **panel:** several chats at once in editor tabs ([290f2a8](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/290f2a83d79f7ee0f064ecf99fb45e027dd553b2))
* **skills:** manage skills globally and per project; the panel uses them ([4829300](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/48293009aa9115df6c61792809009f1dd218eeb1))

# [1.0.0-alpha.16](https://github.com/Datalab-Rotterdam/nova-ai-vscode/compare/v1.0.0-alpha.15...v1.0.0-alpha.16) (2026-10-03)


### Bug Fixes

* stop timed-out and cancelled commands including their children ([1cdeca3](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/1cdeca35aa945e72d75d00a002fb55980e0d6243))


### Features

* Nova chat panel, native agent-mode integration and memory ([60d167a](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/60d167ad2599cb9df250ca605e91d6275aa1b9b0)), closes [#novaFetch](https://github.com/Datalab-Rotterdam/nova-ai-vscode/issues/novaFetch) [#novaMemory](https://github.com/Datalab-Rotterdam/nova-ai-vscode/issues/novaMemory)

# [1.0.0-alpha.15](https://github.com/Datalab-Rotterdam/nova-ai-vscode/compare/v1.0.0-alpha.14...v1.0.0-alpha.15) (2026-08-27)


### Bug Fixes

* package updates ([df05023](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/df050235a8d0f7680a047e1d967590ea5222d13a))

# [1.0.0-alpha.14](https://github.com/Datalab-Rotterdam/nova-ai-vscode/compare/v1.0.0-alpha.13...v1.0.0-alpha.14) (2026-08-27)


### Bug Fixes

* release ([7fc7347](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/7fc7347891fc19d8c54a8ae560f816998b5eb8c6))

# [1.0.0-alpha.13](https://github.com/Datalab-Rotterdam/nova-ai-vscode/compare/v1.0.0-alpha.12...v1.0.0-alpha.13) (2026-08-27)


### Bug Fixes

* reserve safe model context headroom ([b057754](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/b05775490efb3fef30fb220bc75c8e5cc5096972))

# [1.0.0-alpha.12](https://github.com/Datalab-Rotterdam/nova-ai-vscode/compare/v1.0.0-alpha.11...v1.0.0-alpha.12) (2026-05-21)


### Bug Fixes

* release ([a0e95e5](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/a0e95e52d9079b2e404e1ea7da960b1587fd446a))
* release ([505af0a](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/505af0a7f445ad2d7cd394304a251a55720f8ea7))

# [1.0.0-alpha.11](https://github.com/Datalab-Rotterdam/nova-ai-vscode/compare/v1.0.0-alpha.10...v1.0.0-alpha.11) (2026-05-21)


### Features

* token usage tracking and status bar context window display ([84503b8](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/84503b8b0afb257ce442830e9023a21760375533))

# [1.0.0-alpha.10](https://github.com/Datalab-Rotterdam/nova-ai-vscode/compare/v1.0.0-alpha.9...v1.0.0-alpha.10) (2026-05-13)


### Bug Fixes

* added more logging for errors that stream it returning empty response. ([e63c784](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/e63c784602df4fffc829d764eb909551d9629bb4))

# [1.0.0-alpha.9](https://github.com/Datalab-Rotterdam/nova-ai-vscode/compare/v1.0.0-alpha.8...v1.0.0-alpha.9) (2026-05-13)


### Bug Fixes

* system role assignment in update ([70be07c](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/70be07c3baf92d6dbad1af27c48195ba4a077c31))

# [1.0.0-alpha.8](https://github.com/Datalab-Rotterdam/nova-ai-vscode/compare/v1.0.0-alpha.7...v1.0.0-alpha.8) (2026-05-13)


### Bug Fixes

* added detection of stream and tool stalls ([ade8fa5](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/ade8fa53f5231fe8448de75bb2f4dbdf1dc73a7b))
* tests to check for new defaults in context ([00194b7](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/00194b714eb69ca0a3404ff90178ee4742cb6c13))

# [1.0.0-alpha.7](https://github.com/Datalab-Rotterdam/nova-ai-vscode/compare/v1.0.0-alpha.6...v1.0.0-alpha.7) (2026-05-13)


### Bug Fixes

* unable to select model in new versions > 1.120.0 ([7e1bb91](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/7e1bb9179546466ddaf32f0a35d7fe9b9ef2fe39))

# [1.0.0-alpha.6](https://github.com/Datalab-Rotterdam/nova-ai-vscode/compare/v1.0.0-alpha.5...v1.0.0-alpha.6) (2026-04-29)


### Bug Fixes

* add marketplace icon ([3c56081](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/3c5608169f714a2b2ccfd112fde452ac312ace2f))
* bundle nova sdk into extension ([2d5aec0](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/2d5aec065cad37a402316e1e97ebe6c602b0a711))
* package marketplace alpha with semver version ([6de1991](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/6de199131366b7367d71abd5532d84f8a80b10ed))
* publish customer readme update ([78b5129](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/78b51294fb617a414a8adb3081c76f3ba4648a8e))


### Features

* general cleanup + statusbar nova icon ([07b89c1](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/07b89c1a340898167c305ed48d2b03649e3b075c))
* general cleanup + statusbar nova icon ([ec9d982](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/ec9d982bd22e452c15d5f31fd08cb9415a694d62))

# [1.0.0-alpha.5](https://github.com/Datalab-Rotterdam/nova-ai-vscode/compare/v1.0.0-alpha.4...v1.0.0-alpha.5) (2026-04-24)


### Bug Fixes

* publish customer readme update ([04d8ce9](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/04d8ce9f0fe72bd0a5a7834e18406aeee26c5d81))

# [1.0.0-alpha.4](https://github.com/Datalab-Rotterdam/nova-ai-vscode/compare/v1.0.0-alpha.3...v1.0.0-alpha.4) (2026-04-24)


### Bug Fixes

* bundle nova sdk into extension ([c6bd73c](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/c6bd73c9d57161a8d9159bdac1eda4469b941b49))

# [1.0.0-alpha.3](https://github.com/Datalab-Rotterdam/nova-ai-vscode/compare/v1.0.0-alpha.2...v1.0.0-alpha.3) (2026-04-24)


### Bug Fixes

* add marketplace icon ([600e185](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/600e1852234e02cd5dd3f477a30ec352338f5c61))

# [1.0.0-alpha.2](https://github.com/Datalab-Rotterdam/nova-ai-vscode/compare/v1.0.0-alpha.1...v1.0.0-alpha.2) (2026-04-24)


### Bug Fixes

* package marketplace alpha with semver version ([78d9dd5](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/78d9dd580b8ec88a4cfa9ca19d4a22935a0376dd))

# 1.0.0-alpha.1 (2026-04-24)


### Bug Fixes

* compile before packaging vsix ([7cef6f2](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/7cef6f2a3b48e4f70d6031343c9def8134093130))
* configure alpha release branch ([416db61](https://github.com/Datalab-Rotterdam/nova-ai-vscode/commit/416db61e4d443fca235c0c31ceb5cd2c12219c43))
