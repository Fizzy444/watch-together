# Maintainer: Fizzy444 <mr.mithun2521@gmail.com>
#
# Build and install: makepkg -si
# Build package only: makepkg -s

pkgname=watch-together-bin
_pkgname=watch-together
pkgver=1.0.2
pkgrel=1
pkgdesc="Watch movies together in sync with automated Cloudflare tunnels"
arch=('x86_64')
url="https://github.com/Fizzy444/watch-together"
license=('MIT')
depends=(
    'gtk3'
    'nss'
    'alsa-lib'
    'libxss'
    'libxtst'
    'mesa'
)
provides=("${_pkgname}")
conflicts=("${_pkgname}")
source=("https://github.com/Fizzy444/watch-together/releases/download/v${pkgver}/Watch-Together-${pkgver}-linux.deb")
sha256sums=('SKIP')

package() {
    bsdtar -xf data.tar.* -C "${pkgdir}"
}
