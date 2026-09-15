`FolderTest.rar` and `WithComment.rar` are test archives from
[node-unrar-js](https://github.com/YuJianrong/node-unrar.js) (MIT licence), used to test RAR
listing and extraction. They contain only text files.

`symlink.7z` was made for these tests with 7-Zip (`readme.txt` plus an `escape.package` entry), then
its header was edited so `escape.package` is a symbolic link to `../../outside.txt`. The bundled 7za
really creates that link when extracting, which is why WhimWatch refuses such archives.
