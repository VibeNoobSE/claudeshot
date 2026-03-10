registerGame("pong", "🏓 Pong", "W/S = left, ↑/↓ = right", "1v1 classic", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#0a0a1e");
    for (let y = 10; y < H; y += 24) this.add.rectangle(W/2, y, 2, 12, 0x333355);
    this.pL = this.add.rectangle(30, H/2, 12, 80, 0xf7c948);
    this.pR = this.add.rectangle(W-30, H/2, 12, 80, 0xe94560);
    this.physics.add.existing(this.pL); this.physics.add.existing(this.pR);
    [this.pL, this.pR].forEach(p => { p.body.setImmovable(true); p.body.setCollideWorldBounds(true); });
    this.ball = this.add.circle(W/2, H/2, 8, 0xffffff);
    this.physics.add.existing(this.ball);
    this.ball.body.setBounce(1,1).setCollideWorldBounds(true).setMaxVelocity(500,500);
    this.ball.body.onWorldBounds = true;
    this.ball.body.setVelocity(280, Phaser.Math.Between(-150,150));
    this.physics.add.collider(this.ball, this.pL, (b,p) => { b.body.setVelocityY((b.y-p.y)*5); b.body.setVelocityX(b.body.velocity.x*1.05); });
    this.physics.add.collider(this.ball, this.pR, (b,p) => { b.body.setVelocityY((b.y-p.y)*5); b.body.setVelocityX(b.body.velocity.x*1.05); });
    this.sL = 0; this.sR = 0;
    this.scoreTxt = this.add.text(W/2, 30, "0 — 0", { fontSize: "32px", color: "#fff", fontFamily: "monospace" }).setOrigin(0.5);
    this.k = this.input.keyboard.addKeys({ w:"W", s:"S", up:"UP", down:"DOWN" });
    this.physics.world.on("worldbounds", (body,u,d,l,r) => {
      if (l) { this.sR++; this.ball.setPosition(W/2,H/2); this.ball.body.setVelocity(280,Phaser.Math.Between(-150,150)); }
      if (r) { this.sL++; this.ball.setPosition(W/2,H/2); this.ball.body.setVelocity(-280,Phaser.Math.Between(-150,150)); }
      this.scoreTxt.setText(this.sL+" — "+this.sR);
    });
  }
  update() {
    this.pL.body.setVelocityY(this.k.w.isDown?-350:this.k.s.isDown?350:0);
    this.pR.body.setVelocityY(this.k.up.isDown?-350:this.k.down.isDown?350:0);
  }
});
