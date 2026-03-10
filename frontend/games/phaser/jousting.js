registerGame("jousting", "🐴 Jousting", "A/D+W = P1, ←/→+↑ = P2", "Bump from above to win!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#2a1a2e");
    this.plats=this.physics.add.staticGroup();
    this.plats.add(this.add.rectangle(W/2,H-10,W,20,0x2a3a5e));
    [[150,380],[400,300],[650,380],[250,200],[550,200],[400,120]].forEach(([x,y])=>this.plats.add(this.add.rectangle(x,y,110,14,0x2a3a5e)));
    this.p1=this.add.rectangle(100,H-40,24,24,0xf7c948);this.p2=this.add.rectangle(W-100,H-40,24,24,0xe94560);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true).setGravityY(700).setBounce(0.2);p.setData("hp",3);});
    this.physics.add.collider(this.p1,this.plats);this.physics.add.collider(this.p2,this.plats);
    this.physics.add.overlap(this.p1,this.p2,()=>{
      if(this.p1.y<this.p2.y-10){this.hitP(this.p2,"P2");this.p1.body.setVelocityY(-250);}
      else if(this.p2.y<this.p1.y-10){this.hitP(this.p1,"P1");this.p2.body.setVelocityY(-250);}
    });
    this.hp1=this.add.text(16,16,"P1: ♥♥♥",{fontSize:"18px",color:"#f7c948",fontFamily:"monospace"});
    this.hp2=this.add.text(W-140,16,"P2: ♥♥♥",{fontSize:"18px",color:"#e94560",fontFamily:"monospace"});
    this.k=this.input.keyboard.addKeys({a:"A",d:"D",w:"W",left:"LEFT",right:"RIGHT",up:"UP"});this.over=false;
  }
  hitP(p,label){const hp=p.getData("hp")-1;p.setData("hp",hp);
    (label==="P1"?this.hp1:this.hp2).setText(label+": "+(hp>0?"♥".repeat(hp):"DEAD"));
    if(hp<=0&&!this.over){this.over=true;this.add.text(W/2,H/2,(label==="P1"?"P2":"P1")+" WINS!",{fontSize:"36px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}
  }
  update(){if(this.over)return;const k=this.k;
    this.p1.body.setVelocityX(k.a.isDown?-220:k.d.isDown?220:0);
    if(k.w.isDown&&this.p1.body.touching.down)this.p1.body.setVelocityY(-500);
    this.p2.body.setVelocityX(k.left.isDown?-220:k.right.isDown?220:0);
    if(k.up.isDown&&this.p2.body.touching.down)this.p2.body.setVelocityY(-500);
  }
});
